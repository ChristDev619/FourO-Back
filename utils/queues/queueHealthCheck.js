// utils/queues/queueHealthCheck.js
const logger = require('../logger');

/**
 * Check and auto-resume queue if paused
 * This prevents the queue from staying paused accidentally
 */
async function ensureQueueRunning(queue, queueName = 'queue') {
    try {
        const isPaused = await queue.isPaused();
        
        if (isPaused) {
            logger.warn(`⚠️ ${queueName} is PAUSED - auto-resuming...`);
            await queue.resume();
            logger.info(`✅ ${queueName} auto-resumed`);
        } else {
            logger.info(`✅ ${queueName} is running normally`);
        }
        
        return { isPaused: false, autoResumed: isPaused };
    } catch (error) {
        logger.error(`❌ Failed to check ${queueName} status:`, error.message);
        throw error;
    }
}

/**
 * Periodic health check (run every 5 minutes)
 */
function startPeriodicHealthCheck(queue, queueName = 'queue', intervalMs = 300000) {
    setInterval(async () => {
        try {
            await ensureQueueRunning(queue, queueName);
            
            const counts = await queue.getJobCounts();
            logger.info(`Queue health check - ${queueName}`, { counts });
            
            // Alert if too many waiting jobs
            if (counts.waiting > 50) {
                logger.warn(`⚠️ High waiting job count in ${queueName}: ${counts.waiting}`);
            }
            
            // Alert if too many failed jobs
            if (counts.failed > 10) {
                logger.warn(`⚠️ High failed job count in ${queueName}: ${counts.failed}`);
            }
        } catch (error) {
            logger.error(`Queue health check failed for ${queueName}:`, error.message);
        }
    }, intervalMs);
    
    logger.info(`Started periodic health check for ${queueName} (every ${intervalMs}ms)`);
}

module.exports = {
    ensureQueueRunning,
    startPeriodicHealthCheck
};

