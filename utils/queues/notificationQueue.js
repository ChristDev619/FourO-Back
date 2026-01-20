/**
 * Notification Queue for Duration-Based State Change Notifications
 * 
 * SOLID Principles:
 * - Single Responsibility: Manages ONLY notification delay jobs
 * - Open/Closed: Can add new job types without modifying core queue
 * - Dependency Inversion: Uses Redis abstraction from redisConfig
 * 
 * Event-Driven Architecture:
 * - Jobs are scheduled when state changes
 * - Worker processes jobs after delay
 * - No continuous polling required
 * 
 * @module notificationQueue
 */

const Queue = require('bull');
const { bullRedisConfig } = require('../redisConfig');

/**
 * Create robust Redis options for Bull
 * EXACT COPY from recalculationQueue.js (which works!)
 */
function makeRedisOptions(overrides = {}) {
  return {
    // Base from central config
    ...bullRedisConfig,

    // Connect immediately, avoid writes during "still connecting"
    lazyConnect: false,

    // Critical flags for Bull reliability
    enableOfflineQueue: true,
    autoResendUnfulfilledCommands: true,

    // Recommended with Bull: don't fail commands if a reconnection occurs mid-flight
    maxRetriesPerRequest: null,

    // FIX: Remove command timeout to prevent Bull initialization hangs
    commandTimeout: undefined,

    // Reasonable retry strategy
    retryStrategy(times) {
      return Math.min(500 + times * 250, 5000);
    },

    // Reconnect on MOVED/ASK or read-only errors during failover
    reconnectOnError(err) {
      const msg = err && err.message ? err.message : '';
      if (
        msg.includes('READONLY') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('EPIPE') ||
        msg.includes('ECONNRESET') ||
        /Connection is closed/i.test(msg)
      ) {
        return true;
      }
      return false;
    },

    // Allow caller overrides
    ...overrides,
  };
}

/**
 * Notification Queue Instance
 * Handles delayed notification checks for state changes with duration
 * SIMPLIFIED to match recalculationQueue.js structure
 */
const notificationQueue = new Queue('notification-checks', {
    redis: makeRedisOptions(),
    defaultJobOptions: {
        removeOnComplete: parseInt(process.env.NOTIFICATION_QUEUE_REMOVE_ON_COMPLETE || '100', 10),
        removeOnFail: parseInt(process.env.NOTIFICATION_QUEUE_REMOVE_ON_FAIL || '50', 10),
        attempts: parseInt(process.env.NOTIFICATION_QUEUE_ATTEMPTS || '3', 10),
        backoff: {
            type: 'exponential',
            delay: parseInt(process.env.NOTIFICATION_QUEUE_BACKOFF_DELAY_MS || '3000', 10)
        },
        timeout: parseInt(process.env.NOTIFICATION_QUEUE_TIMEOUT_MS || '3600000', 10),
    },
    settings: {
        stalledInterval: parseInt(process.env.NOTIFICATION_QUEUE_STALLED_INTERVAL_MS || '60000', 10),
        maxStalledCount: parseInt(process.env.NOTIFICATION_QUEUE_MAX_STALLED_COUNT || '2', 10),
        lockDuration: parseInt(process.env.NOTIFICATION_QUEUE_LOCK_DURATION_MS || '3600000', 10),
        lockRenewTime: parseInt(process.env.NOTIFICATION_QUEUE_LOCK_RENEW_TIME_MS || '1800000', 10),
    }
});

// Debug: Log queue client connection status
console.log('🔍 Notification Queue created, checking Redis clients...');
if (notificationQueue.client) {
    console.log('  ✅ Queue client exists');
    notificationQueue.client.on('connect', () => console.log('  🔗 Queue client connected to Redis'));
    notificationQueue.client.on('ready', () => console.log('  ✅ Queue client ready'));
    notificationQueue.client.on('error', (err) => console.error('  ❌ Queue client error:', err.message));
} else {
    console.log('  ❌ Queue client is NULL!');
}

/**
 * Job Type Constants
 * Defines different types of notification jobs
 */
const JOB_TYPES = {
    CHECK_DURATION: 'check-duration',
    ESCALATION_CHECK: 'escalation-check',
};

// NOTE: Event listeners moved to notificationWorker.js to avoid blocking module load

/**
 * Helper function to schedule a notification job (duration check or escalation)
 * 
 * @param {string} jobType - Job type from JOB_TYPES (CHECK_DURATION or ESCALATION_CHECK)
 * @param {Object} jobData - Job data (structure depends on job type)
 * @param {Object} options - Optional job options (delay, attempts, etc.)
 * @returns {Promise<Job>} Bull job instance
 */
async function scheduleDurationCheck(jobType, jobData, options = {}) {
    // Generate job ID based on type
    let jobId;
    if (jobType === JOB_TYPES.CHECK_DURATION) {
        jobId = `duration-${jobData.eventId}-tag-${jobData.tagId}-${Date.now()}`;
    } else if (jobType === JOB_TYPES.ESCALATION_CHECK) {
        jobId = `escalation-${jobData.notificationId}-level-${jobData.currentLevel}-${Date.now()}`;
    } else {
        jobId = `notification-${Date.now()}`;
    }
    
    const delayMs = options.delay || 0;
    console.log(`📅 Scheduling ${jobType} job: ${jobId} (delay: ${delayMs}ms)`);
    
    try {
        const job = await notificationQueue.add(
            jobType,
            {
                ...jobData,
                scheduledAt: new Date().toISOString(),
                executeAt: new Date(Date.now() + delayMs).toISOString(),
            },
            {
                ...options,
                jobId: jobId,
                priority: options.priority || 1, // Higher priority for time-sensitive notifications
            }
        );
        
        console.log(`✅ Job successfully queued: ${jobId}, Job ID in Bull: ${job.id}`);
        return job;
    } catch (error) {
        console.error(`❌ Failed to schedule ${jobType} job ${jobId}:`, error.message);
        console.error('Queue status:', {
            isReady: notificationQueue.client ? 'connected' : 'not connected',
            error: error.stack
        });
        throw error;
    }
}

/**
 * Cancel pending jobs for a specific event and tag OR by job ID
 * Useful when state changes before duration completes or when notification is acknowledged
 * 
 * @param {number|string} eventIdOrJobId - Event ID (number) OR Job ID (string)
 * @param {number} [tagId] - Tag ID (optional, only used if first param is eventId)
 * @returns {Promise<number|boolean>} Number of jobs cancelled (eventId mode) or boolean (jobId mode)
 */
async function cancelPendingJobs(eventIdOrJobId, tagId) {
    try {
        // Mode 1: Cancel by job ID (string) - for escalation cancellation
        if (typeof eventIdOrJobId === 'string') {
            const jobId = eventIdOrJobId;
            const job = await notificationQueue.getJob(jobId);
            
            if (job) {
                await job.remove();
                console.log(`❌ Cancelled job ${jobId}`);
                return true;
            } else {
                console.log(`⚠️  Job ${jobId} not found in queue`);
                return false;
            }
        }
        
        // Mode 2: Cancel by eventId + tagId (number) - for duration checks
        const eventId = eventIdOrJobId;
        const [waiting, delayed] = await Promise.all([
            notificationQueue.getWaiting(),
            notificationQueue.getDelayed()
        ]);
        
        const allJobs = [...waiting, ...delayed];
        let cancelledCount = 0;
        
        for (const job of allJobs) {
            if (job.data.eventId === eventId && job.data.tagId === tagId) {
                await job.remove();
                cancelledCount++;
                console.log(`❌ Cancelled job ${job.id} for event ${eventId}, tag ${tagId}`);
            }
        }
        
        return cancelledCount;
    } catch (error) {
        console.error('Error cancelling pending jobs:', error);
        return 0;
    }
}

/**
 * Get queue statistics
 * @returns {Promise<Object>} Queue stats
 */
async function getQueueStats() {
    try {
        const counts = await notificationQueue.getJobCounts();
        return {
            waiting: counts.waiting || 0,
            active: counts.active || 0,
            completed: counts.completed || 0,
            failed: counts.failed || 0,
            delayed: counts.delayed || 0,
            total: (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0)
        };
    } catch (error) {
        console.error('Error getting queue stats:', error);
        return { error: error.message };
    }
}

/**
 * Clean old jobs from the queue
 * @param {number} olderThanHours - Remove jobs older than this many hours
 * @returns {Promise<number>} Number of jobs removed
 */
async function cleanOldJobs(olderThanHours = 24) {
    try {
        const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
        
        const [completed, failed] = await Promise.all([
            notificationQueue.getCompleted(0, 1000),
            notificationQueue.getFailed(0, 1000)
        ]);
        
        let removedCount = 0;
        
        for (const job of [...completed, ...failed]) {
            if (job.finishedOn && job.finishedOn < cutoffTime) {
                await job.remove();
                removedCount++;
            }
        }
        
        console.log(`🧹 Cleaned ${removedCount} old notification jobs (older than ${olderThanHours}h)`);
        return removedCount;
    } catch (error) {
        console.error('Error cleaning old jobs:', error);
        return 0;
    }
}

module.exports = {
    notificationQueue,
    JOB_TYPES,
    scheduleDurationCheck,
    cancelPendingJobs,
    getQueueStats,
    cleanOldJobs,
};

