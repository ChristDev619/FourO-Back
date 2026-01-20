// utils/queues/deadLetterQueue.js
const Queue = require('bull');
const { bullRedisConfig } = require('../redisConfig');

/**
 * Dead Letter Queue - Stores permanently failed jobs for manual review/retry
 * Jobs end up here after exhausting all retry attempts in the main queue
 */
const deadLetterQueue = new Queue('recalculation-dlq', {
    redis: bullRedisConfig,
    defaultJobOptions: {
        removeOnComplete: false,  // Keep completed (retried) jobs
        removeOnFail: false,      // Keep all failed jobs forever
        attempts: 1,              // Don't retry jobs in DLQ
    }
});

/**
 * Add a failed job to the DLQ with full context
 */
async function addToDeadLetterQueue(originalJob, error) {
    try {
        await deadLetterQueue.add({
            // Original job data
            jobId: originalJob.data.jobId,
            
            // Failure context
            originalQueueJobId: originalJob.id,
            failedAt: new Date().toISOString(),
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            
            // Retry history
            attempts: originalJob.attemptsMade,
            lastAttemptAt: new Date(originalJob.processedOn || Date.now()).toISOString(),
            
            // Original job metadata
            createdAt: new Date(originalJob.timestamp).toISOString(),
            firstAttemptedAt: new Date(originalJob.processedOn).toISOString(),
        }, {
            // Keep in DLQ forever until manually removed
            removeOnComplete: false,
            removeOnFail: false,
            
            // Optional: Set priority based on how critical the job is
            priority: 5
        });
        
        console.log(`✅ Job ${originalJob.data.jobId} added to Dead Letter Queue`);
        return true;
    } catch (dlqError) {
        console.error(`❌ Failed to add job to DLQ:`, dlqError);
        return false;
    }
}

/**
 * Manually retry a job from the DLQ
 */
async function retryFromDLQ(dlqJobId) {
    try {
        const dlqJob = await deadLetterQueue.getJob(dlqJobId);
        
        if (!dlqJob) {
            throw new Error(`DLQ Job ${dlqJobId} not found`);
        }
        
        // Get original recalculation queue
        const recalculationQueue = require('./recalculationQueue');
        
        // Re-add to main queue with high priority
        await recalculationQueue.add(
            { jobId: dlqJob.data.jobId },
            { priority: 1 }  // High priority for manual retries
        );
        
        // Update job data to track retry, then remove from DLQ
        const currentRetries = (dlqJob.data.retried || 0) + 1;
        await dlqJob.update({
            ...dlqJob.data,
            retried: currentRetries,
            retriedAt: new Date().toISOString()
        });
        
        // Remove from DLQ (it's been retried)
        await dlqJob.remove();
        
        console.log(`✅ Job ${dlqJob.data.jobId} moved from DLQ back to main queue (retry #${currentRetries})`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to retry job from DLQ:`, error);
        throw error;
    }
}

/**
 * Get all jobs in the DLQ
 */
async function getDLQJobs(status = 'waiting', limit = 50) {
    try {
        let jobs;
        
        switch (status) {
            case 'waiting':
                jobs = await deadLetterQueue.getWaiting(0, limit);
                break;
            case 'completed':
                jobs = await deadLetterQueue.getCompleted(0, limit);
                break;
            case 'all':
                const [waiting, completed] = await Promise.all([
                    deadLetterQueue.getWaiting(0, limit),
                    deadLetterQueue.getCompleted(0, limit)
                ]);
                jobs = [...waiting, ...completed];
                break;
            default:
                jobs = await deadLetterQueue.getWaiting(0, limit);
        }
        
        return jobs.map(job => ({
            dlqJobId: job.id,
            jobId: job.data.jobId,
            failedAt: job.data.failedAt,
            error: job.data.error,
            attempts: job.data.attempts,
            status: job.finishedOn ? 'retried' : 'waiting',
            retriedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null
        }));
    } catch (error) {
        console.error('Failed to get DLQ jobs:', error);
        throw error;
    }
}

/**
 * Clear completed (retried) jobs from DLQ
 */
async function clearRetriedJobs() {
    try {
        const completed = await deadLetterQueue.getCompleted();
        let count = 0;
        
        for (const job of completed) {
            await job.remove();
            count++;
        }
        
        console.log(`✅ Removed ${count} retried jobs from DLQ`);
        return count;
    } catch (error) {
        console.error('Failed to clear retried jobs:', error);
        throw error;
    }
}

module.exports = {
    deadLetterQueue,
    addToDeadLetterQueue,
    retryFromDLQ,
    getDLQJobs,
    clearRetriedJobs
};

