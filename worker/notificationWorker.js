/**
 * Notification Worker - Event-Driven Processor
 * 
 * SOLID Principles:
 * - Single Responsibility: Processes ONLY notification duration checks
 * - Open/Closed: Can add new job types without modifying core processing
 * - Dependency Inversion: Depends on service abstractions
 * 
 * Event-Driven Architecture:
 * - Waits passively for delayed jobs to become ready
 * - Processes jobs only when duration has elapsed
 * - No active polling - purely reactive
 * 
 * @module notificationWorker
 */

require('dotenv').config();

// Import dependencies FIRST (NotificationDurationService imports notificationQueue internally)
const NotificationDurationService = require('../utils/services/NotificationDurationService');
const EscalationService = require('../utils/services/EscalationService');
const { NotificationEvent, Notification, User, Tags, Location, Line, sequelize } = require('../dbInit');
const { getEventRecipients, createNotificationsForEvent } = require('../handlers/notificationEventHandler');
const logger = require('../utils/logger');
const moment = require('moment');
const cron = require('node-cron');
const { getDuplicateJobMonitor } = require('../utils/services/DuplicateJobMonitorService');

// Import queue LAST to avoid circular dependency issues
const { notificationQueue, JOB_TYPES } = require('../utils/queues/notificationQueue');

// Concurrency - how many jobs to process simultaneously (default: 1 for sequential processing)
const concurrency = Math.max(1, Math.min(parseInt(process.env.NOTIFICATION_QUEUE_CONCURRENCY || '2', 10), 5));

console.log(`🔔 Notification Worker starting with concurrency: ${concurrency}`);

/**
 * Timeout wrapper for async operations
 * Prevents operations from hanging indefinitely
 */
async function withTimeout(promise, ms, label = 'operation') {
    return await Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        )
    ]);
}

/**
 * Main Job Processor
 * Handles duration check jobs from the queue
 */
async function processNotificationJob(job) {
    const startTime = Date.now();
    const { eventId, tagId, expectedState } = job.data;
    
    try {
        logger.info(`🔔 Processing notification duration check`, { 
            jobId: job.id, 
            eventId, 
            tagId, 
            expectedState 
        });

        // Step 1: Execute duration check (verify state persisted)
        const checkResult = await NotificationDurationService.executeDurationCheck(job.data);
        
        // Update job progress
        await job.progress(50);

        if (!checkResult.triggered) {
            // State didn't persist or other condition not met
            const message = NotificationDurationService.getStatusMessage(checkResult);
            logger.info(`⏭️  Skipping notification`, { 
                jobId: job.id, 
                eventId, 
                reason: checkResult.reason, 
                message 
            });
            
            return {
                success: true,
                triggered: false,
                reason: checkResult.reason,
                message: message,
                duration: Date.now() - startTime,
            };
        }

        // Step 2: Fetch full event details with associations
        const event = await NotificationEvent.findByPk(eventId, {
            include: [
                {
                    model: Tags,
                    as: 'tag',
                    attributes: ['id', 'name', 'ref', 'taggableType', 'taggableId', 'currentValue']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email']
                },
                {
                    model: Location,
                    as: 'filterLocation',
                    required: false,
                    attributes: ['id', 'name']
                },
                {
                    model: Line,
                    as: 'filterLine',
                    required: false,
                    attributes: ['id', 'name']
                }
            ]
        });

        if (!event) {
            logger.warn(`⚠️  Event ${eventId} not found`);
            return { success: false, error: 'Event not found' };
        }

        // Step 3: Get recipient users
        const users = await getEventRecipients(event);
        
        if (users.length === 0) {
            logger.warn(`⚠️  No recipients found for event ${eventId}`);
            return { success: false, error: 'No recipients found' };
        }

        // Update job progress
        await job.progress(75);

        // Step 4: Create tag operation object for notification creation
        const tagOp = {
            tagId: tagId,
            value: expectedState,
            oldValue: job.data.oldValue || null,
        };

        // Step 5: Create notifications and send
        await createNotificationsForEvent(
            event,
            users,
            tagOp,
            moment().format('YYYY-MM-DD HH:mm:ss')
        );

        // Step 6: Update last triggered timestamp (use real-time, not operation time)
        await event.update({ 
            lastTriggeredAt: moment().format('YYYY-MM-DD HH:mm:ss') 
        });

        // Complete!
        await job.progress(100);

        const duration = Date.now() - startTime;
        logger.info(`✅ Notification triggered successfully`, { 
            jobId: job.id, 
            eventId, 
            userCount: users.length,
            duration: `${duration}ms`,
            statePersisted: `${job.data.duration} ${job.data.durationUnit}`
        });

        return {
            success: true,
            triggered: true,
            eventId: eventId,
            userCount: users.length,
            duration: duration,
            statePersisted: `${job.data.duration} ${job.data.durationUnit}`,
        };

    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`❌ Error processing notification job ${job.id}`, { 
            error: error.message, 
            eventId, 
            tagId,
            duration: `${duration}ms`,
            stack: error.stack 
        });

        throw error; // Let Bull handle retries
    }
}

/**
 * Initialize Duplicate Job Monitor
 * Schedules daily check at 8:00 AM UTC
 */
function initializeDuplicateJobMonitor() {
    try {
        const duplicateJobMonitor = getDuplicateJobMonitor();
        
        // Schedule cron job: "0 8 * * *" = Every day at 8:00 AM UTC
        // Format: minute hour day month dayOfWeek
        const cronSchedule = '0 8 * * *';
        
        cron.schedule(cronSchedule, async () => {
            logger.info('[DuplicateJobMonitor] 🕐 Triggered scheduled check at 8:00 AM UTC');
            try {
                await duplicateJobMonitor.runDailyCheck();
            } catch (error) {
                logger.error('[DuplicateJobMonitor] ❌ Unhandled error in scheduled check', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }, {
            timezone: 'UTC' // Ensure it runs at 8 AM UTC
        });
        
        logger.info('[DuplicateJobMonitor] ✅ Scheduled daily check at 8:00 AM UTC');
        console.log('✅ Duplicate Job Monitor scheduled: Daily at 8:00 AM UTC');
        
    } catch (error) {
        logger.error('[DuplicateJobMonitor] ❌ Failed to initialize scheduler', {
            error: error.message,
            stack: error.stack
        });
        // Don't crash the worker if monitor fails to initialize
        console.error('⚠️ Warning: Duplicate Job Monitor failed to initialize:', error.message);
    }
}

/**
 * Escalation Job Processor
 * Handles escalation check jobs - verifies if notification was acknowledged
 * and escalates to next level if needed
 */
async function processEscalationJob(job) {
    const startTime = Date.now();
    const { notificationId, eventId, currentLevel } = job.data;
    
    try {
        logger.info(`📧 Processing escalation check`, { 
            jobId: job.id, 
            notificationId, 
            eventId,
            currentLevel 
        });

        // Execute escalation check (verifies acknowledgment and triggers next level)
        const escalationResult = await EscalationService.executeEscalationCheck(job.data);
        
        await job.progress(100);

        const duration = Date.now() - startTime;

        if (escalationResult.escalated) {
            // Escalation triggered
            logger.info(`✅ Notification escalated successfully`, { 
                jobId: job.id, 
                notificationId,
                escalationLevel: escalationResult.escalationLevel,
                escalationUserEmail: escalationResult.escalationUserEmail,
                duration: `${duration}ms`
            });

            return {
                success: true,
                escalated: true,
                notificationId: notificationId,
                escalationLevel: escalationResult.escalationLevel,
                escalationUserId: escalationResult.escalationUserId,
                duration: duration,
            };
        } else {
            // Escalation not triggered (acknowledged or max level reached)
            logger.info(`⏭️  Escalation check completed - no escalation`, { 
                jobId: job.id, 
                notificationId,
                reason: escalationResult.reason,
                duration: `${duration}ms`
            });

            return {
                success: true,
                escalated: false,
                reason: escalationResult.reason,
                duration: duration,
            };
        }

    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`❌ Error processing escalation job ${job.id}`, { 
            error: error.message, 
            notificationId, 
            eventId,
            currentLevel,
            duration: `${duration}ms`,
            stack: error.stack 
        });

        throw error; // Let Bull handle retries
    }
}

/**
 * Initialize Worker
 * Sets up job processor and event listeners
 */
(async () => {
    let retryCount = 0;
    const maxRetries = 10;
    
    console.log('🚀 Starting notification worker initialization...');
    
    while (retryCount < maxRetries) {
        try {
            console.log(`Attempting to initialize notification worker (attempt ${retryCount + 1}/${maxRetries})`);
            logger.info(`Attempting to initialize notification worker (attempt ${retryCount + 1}/${maxRetries})`);
            
            // Register job processor for duration checks
            // Bull v3 handles Redis connection internally, no need for isReady()
            console.log('Registering job processors...');
            notificationQueue.process(JOB_TYPES.CHECK_DURATION, concurrency, async (job) => {
                return await processNotificationJob(job);
            });

            // Register job processor for escalation checks
            notificationQueue.process(JOB_TYPES.ESCALATION_CHECK, concurrency, async (job) => {
                return await processEscalationJob(job);
            });

            console.log('✅ Notification worker is now processing jobs');
            logger.info('✅ Notification worker is now processing jobs', { 
                concurrency,
                jobTypes: [JOB_TYPES.CHECK_DURATION, JOB_TYPES.ESCALATION_CHECK]
            });
            
            // Initialize duplicate job monitor with cron schedule
            initializeDuplicateJobMonitor();
            
            break; // Success!
            
        } catch (error) {
            retryCount++;
            logger.error(`Failed to initialize notification worker (attempt ${retryCount}/${maxRetries})`, { 
                error: error.message,
                retryCount,
                maxRetries
            });
            
            if (retryCount >= maxRetries) {
                logger.error('Max retries reached, exiting notification worker');
                process.exit(1);
            }
            
            // Exponential backoff
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 30000);
            logger.info(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
})().catch((err) => {
    console.error('❌ FATAL: Unhandled error in notification worker initialization:', err);
    console.error(err.stack);
    process.exit(1);
});

/**
 * Queue Event Listeners
 */
notificationQueue.on('error', (err) => {
    logger.error('Notification queue error', { error: err.message });
});

notificationQueue.on('waiting', (jobId) => {
    logger.info('Notification job waiting', { jobId, status: 'waiting' });
});

notificationQueue.on('active', (job) => {
    logger.info('Notification job active', { jobId: job.id, eventId: job.data.eventId, status: 'active' });
});

notificationQueue.on('completed', (job, result) => {
    logger.info('Notification job completed', { 
        jobId: job.id, 
        triggered: result.triggered,
        status: 'completed' 
    });
});

notificationQueue.on('failed', (job, err) => {
    logger.error('Notification job failed', { 
        jobId: job.id, 
        eventId: job?.data?.eventId,
        error: err.message, 
        status: 'failed' 
    });
});

notificationQueue.on('stalled', (job) => {
    logger.warn('Notification job stalled', { 
        jobId: job.id, 
        eventId: job?.data?.eventId,
        status: 'stalled' 
    });
});

/**
 * Process Error Handlers
 */
process.on('unhandledRejection', (reason) => {
    logger.error('UNHANDLED REJECTION in notification worker', { reason });
});

process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION in notification worker', { 
        error: err.message, 
        stack: err.stack 
    });
});

/**
 * Graceful Shutdown
 */
process.on('SIGTERM', async () => {
    logger.info('Notification worker received SIGTERM - shutting down gracefully');
    try {
        await notificationQueue.close();
        logger.info('Notification queue closed gracefully');
    } catch (err) {
        logger.error('Error closing notification queue', { error: err.message });
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Notification worker received SIGINT - shutting down gracefully');
    try {
        await notificationQueue.close();
        logger.info('Notification queue closed gracefully');
    } catch (err) {
        logger.error('Error closing notification queue', { error: err.message });
    }
    process.exit(0);
});

logger.info('🔔 Notification duration worker started and listening for jobs...');
