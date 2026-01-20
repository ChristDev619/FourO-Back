const Redis = require('ioredis');
const { getGlobalJobNotificationService } = require('./GlobalJobNotificationService');
const logger = require('../logger');

class JobStatusService {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST,
            port: 6379, // Temporarily using non-SSL port for testing
            password: process.env.REDIS_PASSWORD,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
            lazyConnect: true,
            // TLS temporarily disabled for testing
            // tls: process.env.REDIS_HOST && (process.env.REDIS_HOST.includes('azure') || process.env.REDIS_HOST.includes('redis.cache.windows.net')) ? {
            //     rejectUnauthorized: false,
            //     secureProtocol: 'TLSv1_2_method'
            // } : undefined
        });
    }

    // Set job status
    async setJobStatus(jobId, status, progress = 0, message = '') {
        const statusData = {
            jobId,
            status, // 'pending', 'processing', 'completed', 'failed'
            progress, // 0-100
            message,
            timestamp: new Date().toISOString()
        };
        
        const key = `job:${jobId}:status`;
        await this.redis.setex(key, 3600, JSON.stringify(statusData)); // Expire in 1 hour
        
        logger.info('Job status updated', { jobId, status, progress });
        return statusData;
    }

    // Get job status
    async getJobStatus(jobId) {
        const key = `job:${jobId}:status`;
        const statusData = await this.redis.get(key);
        
        if (!statusData) {
            return {
                jobId,
                status: 'not_found',
                progress: 0,
                message: 'Job not found',
                timestamp: new Date().toISOString()
            };
        }
        
        return JSON.parse(statusData);
    }

    // Process job asynchronously
    async processJobAsync(jobId, processingFunction) {
        try {
            // Set initial status
            await this.setJobStatus(jobId, 'pending', 0, 'Job queued for processing');
            
            // Start processing in background
            setImmediate(async () => {
                try {
                    // Update to processing
                    await this.setJobStatus(jobId, 'processing', 10, 'Starting recalculation...');
                    
                    // Execute the actual processing function
                    await processingFunction(jobId);
                    
                    // Update to completed
                    await this.setJobStatus(jobId, 'completed', 100, 'Recalculation completed successfully');
                    
                    // Send notification
                    try {
                        const jobNotificationService = getGlobalJobNotificationService();
                        await jobNotificationService.notifyJobSuccess(
                            jobId,
                            `Recalculation completed successfully for job ${jobId}`
                        );
                    } catch (notificationError) {
                        logger.warn('Notification failed for job', { jobId, error: notificationError.message });
                    }
                    
                } catch (error) {
                    logger.error('Job processing failed', { jobId, error: error.message, stack: error.stack });
                    
                    // Update to failed
                    await this.setJobStatus(jobId, 'failed', 0, `Error: ${error.message}`);
                    
                    // Send error notification
                    try {
                        const jobNotificationService = getGlobalJobNotificationService();
                        await jobNotificationService.notifyJobError(
                            jobId,
                            `Recalculation failed for job ${jobId}: ${error.message}`
                        );
                    } catch (notificationError) {
                        logger.warn('Error notification failed for job', { jobId, error: notificationError.message });
                    }
                }
            });
            
            return { success: true, message: 'Job queued for processing' };
            
        } catch (error) {
            logger.error('Failed to queue job', { jobId, error: error.message, stack: error.stack });
            return { success: false, message: `Failed to queue job: ${error.message}` };
        }
    }

    // Clean up old job statuses
    async cleanupOldJobs() {
        // This could be called periodically to clean up old job statuses
        // For now, we rely on Redis TTL (1 hour)
    }
}

// Singleton instance
let jobStatusService = null;

function getJobStatusService() {
    if (!jobStatusService) {
        jobStatusService = new JobStatusService();
    }
    return jobStatusService;
}

module.exports = {
    JobStatusService,
    getJobStatusService
};
