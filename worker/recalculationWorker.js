require('dotenv').config();

const recalculationQueue = require('../utils/queues/recalculationQueue');
// ✅ Import from the same module entry the API uses
const { recalculateAggregatesForJob } = require('../utils/modules');

const {
  setGlobalJobNotificationService,
  getGlobalJobNotificationService,
} = require('../utils/services/GlobalJobNotificationService');

const logger = require('../utils/logger');
const { ensureQueueRunning } = require('../utils/queues/queueHealthCheck');
const { addToDeadLetterQueue } = require('../utils/queues/deadLetterQueue');

// Concurrency configurable via environment; clamp to safe range [1..4]
const concurrency = Math.max(1, Math.min(parseInt(process.env.QUEUE_CONCURRENCY || '1', 10), 4));

// Create a mock jobSubscriptions Map for the worker process
// (The worker uses Redis pub/sub to notify the API process)
const mockJobSubscriptions = new Map();

// Initialize the global service for the worker process
setGlobalJobNotificationService(mockJobSubscriptions);

// ---------- Queue lifecycle logs (high signal) ----------
recalculationQueue.on('ready', () => {
  logger.info('Recalculation queue is ready', { status: 'redis_connected' });
});

recalculationQueue.on('error', (err) => {
  logger.error('Recalculation queue error', { error: err && err.message ? err.message : err });
});

recalculationQueue.on('waiting', (jobId) => {
  logger.info('Job waiting', { jobId, status: 'waiting' });
});

recalculationQueue.on('active', (job) => {
  logger.info('Job active', { jobId: job && job.id, data: job && job.data, status: 'active' });
});

recalculationQueue.on('completed', (job) => {
  logger.info('Job completed', { jobId: job && job.id, status: 'completed' });
});

recalculationQueue.on('failed', async (job, err) => {
  logger.error('Job failed', { 
    jobId: job && job.id, 
    productionJobId: job && job.data && job.data.jobId,
    error: err && err.message ? err.message : err, 
    attempt: job && job.attemptsMade,
    maxAttempts: job && job.opts && job.opts.attempts,
    status: 'failed' 
  });
  
  // Check if this was the final attempt - if so, move to Dead Letter Queue
  try {
    const maxAttempts = (job && job.opts && job.opts.attempts) || 5;
    const attemptsMade = (job && job.attemptsMade) || 0;
    
    if (attemptsMade >= maxAttempts) {
      logger.error('Job permanently failed - moving to Dead Letter Queue', {
        queueJobId: job && job.id,
        productionJobId: job && job.data && job.data.jobId,
        attempts: attemptsMade,
        error: err && err.message
      });
      
      // Add to Dead Letter Queue for manual review/retry
      const success = await addToDeadLetterQueue(job, err);
      
      if (success) {
        logger.info('Job successfully moved to DLQ', { 
          productionJobId: job && job.data && job.data.jobId 
        });
      } else {
        logger.error('Failed to move job to DLQ - job data may be lost', { 
          productionJobId: job && job.data && job.data.jobId 
        });
      }
    } else {
      logger.info('Job will retry', {
        productionJobId: job && job.data && job.data.jobId,
        attempt: attemptsMade,
        remaining: maxAttempts - attemptsMade
      });
    }
  } catch (dlqError) {
    logger.error('Error handling failed job', { 
      error: dlqError && dlqError.message,
      productionJobId: job && job.data && job.data.jobId
    });
  }
});

recalculationQueue.on('stalled', (job) => {
  const { jobId } = job.data || {};
  logger.queue.jobStalled(jobId, job && job.data);
  logger.warn('Job stalled', { jobId: job && job.id, data: job && job.data, status: 'stalled' });
});

// ---------- Defer process() until queue is fully ready ----------
(async () => {
  let retryCount = 0;
  const maxRetries = 10;
  
  while (retryCount < maxRetries) {
    try {
      logger.info(`Attempting to initialize worker (attempt ${retryCount + 1}/${maxRetries})`);
      
      // Ensure Bull's three Redis clients (client/subscriber/blocking) are all ready
      await recalculationQueue.isReady();
      
      logger.info('Queue is ready, setting up job processor');
      
      // Check and auto-resume queue if paused on startup
      await ensureQueueRunning(recalculationQueue, 'recalculation');

      // Utility: guard any async op with a timeout to avoid hanging the processor
      async function withTimeout(promise, ms, label = 'operation') {
        return await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
        ]);
      }

      // Explicit concurrency configurable via env
      recalculationQueue.process(concurrency, async (job) => {
        const { jobId } = job.data;
        const startTime = Date.now();

        try {
          // Log job start
          logger.queue.jobStarted(jobId, job.data);

          // Run the recalculation (includes OEE Time Series calculation)
          await recalculateAggregatesForJob(jobId);

          const duration = Date.now() - startTime;
          logger.queue.jobCompleted(jobId, duration);
          
          // Log OEE calculation completion specifically
          logger.info("Recalculation job completed successfully", { 
            jobId, 
            duration: `${duration}ms`,
            includesOEE: true 
          });

          // Notify via Redis pub/sub (guard with timeout; never let this hang the job)
          try {
            const jobNotificationService = getGlobalJobNotificationService();
            if (jobNotificationService && typeof jobNotificationService.notifyJobSuccess === 'function') {
              const notifyTimeoutMs = parseInt(60000, 10);
              await withTimeout(
                jobNotificationService.notifyJobSuccess(
                  jobId,
                  `Recalculation completed successfully for job ${jobId}`
                ),
                notifyTimeoutMs,
                'notifyJobSuccess'
              );
            }
          } catch (notificationError) {
            logger.warn('Notification failed or timed out for job but job completed successfully', { jobId, error: notificationError.message });
            // Don't fail the job if notification fails
          }

          return { ok: true, jobId, duration };
        } catch (err) {
          const duration = Date.now() - startTime;

          // --- All errors will retry per queue options, then move to DLQ if max retries exceeded ---
          logger.queue.jobFailed(jobId, err, job.data);

          // Notify via Redis pub/sub (guard with timeout; don't let notification hang)
          try {
            const jobNotificationService = getGlobalJobNotificationService();
            if (jobNotificationService && typeof jobNotificationService.notifyJobError === 'function') {
              const notifyTimeoutMs = parseInt(60000);
              await withTimeout(
                jobNotificationService.notifyJobError(
                  jobId,
                  `Recalculation failed for job ${jobId}`,
                  err
                ),
                notifyTimeoutMs,
                'notifyJobError'
              );
            }
          } catch (notificationError) {
            logger.warn('Error notification failed or timed out for job', { jobId, error: notificationError.message });
            // Don't fail the job if notification fails
          }

          throw err; // Let Bull handle retries for real errors
        }
      });

      logger.info('Worker is now processing jobs', { status: 'processing' });
      break; // Success, exit the retry loop
      
    } catch (e) {
      retryCount++;
      logger.error(`Failed to initialize worker processing (attempt ${retryCount}/${maxRetries})`, { 
        error: e && e.message ? e.message : e,
        retryCount,
        maxRetries
      });
      
      if (retryCount >= maxRetries) {
        logger.error('Max retries reached, exiting worker', { retryCount, maxRetries });
        process.exit(1);
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
      logger.info(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
})();

// ---------- Basic crash guards ----------
process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION in worker', { reason });
});

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION in worker', { error: err.message, stack: err.stack });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Worker received SIGTERM - shutting down gracefully', { signal: 'SIGTERM' });
  try {
    await recalculationQueue.close();
    logger.info('Queue closed gracefully', { status: 'shutdown_complete' });
  } catch (err) {
    logger.error('Error closing queue', { error: err.message, stack: err.stack });
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Worker received SIGINT - shutting down gracefully', { signal: 'SIGINT' });
  try {
    await recalculationQueue.close();
    logger.info('Queue closed gracefully', { status: 'shutdown_complete' });
  } catch (err) {
    logger.error('Error closing queue', { error: err.message, stack: err.stack });
  }
  process.exit(0);
});

logger.info('Recalculation worker started and listening for jobs...');
