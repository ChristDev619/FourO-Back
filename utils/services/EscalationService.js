/**
 * Notification Escalation Service
 * 
 * SOLID Principles:
 * - Single Responsibility: Handles ONLY escalation workflow logic
 * - Open/Closed: Can extend with new escalation strategies without modifying core
 * - Dependency Inversion: Depends on abstractions (queue, models)
 * 
 * Escalation Pattern:
 * - Sequential escalation (User 1 → User 2 → User 3)
 * - Only original user acknowledgment cancels escalation chain
 * - Escalated users receive notification copies for awareness
 * - Each level schedules next escalation check
 * 
 * @module EscalationService
 */

const { toMilliseconds, validateDuration } = require('../helpers/durationConverter');
const { Notification, NotificationEvent, User, Tags } = require('../../dbInit');
const moment = require('moment');
const crypto = require('crypto');
const logger = require('../logger');

class EscalationService {
    /**
     * Check if event requires escalation setup
     * 
     * @param {Object} event - NotificationEvent model instance
     * @returns {Boolean} True if escalation is enabled and configured
     */
    static requiresEscalation(event) {
        return (
            event.enableEscalation === true &&
            event.escalationDelay > 0 &&
            event.escalationUserIds &&
            Array.isArray(event.escalationUserIds) &&
            event.escalationUserIds.length > 0
        );
    }

    /**
     * Schedule an escalation check job after notification is sent
     * 
     * @param {Object} notification - Notification model instance (just created)
     * @param {Object} event - NotificationEvent model instance
     * @returns {Promise<Object>} Job details or null if not scheduled
     */
    static async scheduleEscalationCheck(notification, event) {
        try {
            // Validate escalation is enabled
            if (!this.requiresEscalation(event)) {
                return null;
            }

            // Only schedule for original notifications (not escalated copies)
            if (notification.escalationLevel > 0) {
                logger.info(`⚠️  Skipping escalation schedule for level ${notification.escalationLevel} notification`);
                return null;
            }

            // Validate escalation delay
            const validation = validateDuration(event.escalationDelay, event.escalationDelayUnit);
            if (!validation.valid) {
                logger.error(`❌ Invalid escalation delay for event ${event.id}:`, validation.error);
                return null;
            }

            // Convert delay to milliseconds
            const delayMs = toMilliseconds(event.escalationDelay, event.escalationDelayUnit);
            
            // Prepare job data
            const jobData = {
                notificationId: notification.id,
                eventId: event.id,
                currentLevel: notification.escalationLevel, // 0 for original
                scheduledAt: new Date().toISOString(),
            };

            // Lazy-load queue to avoid circular dependency
            const { scheduleDurationCheck, JOB_TYPES } = require('../queues/notificationQueue');
            
            // Schedule the job using ESCALATION_CHECK type
            const job = await scheduleDurationCheck(
                JOB_TYPES.ESCALATION_CHECK,
                jobData,
                {
                    delay: delayMs,
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                    removeOnComplete: false, // Keep for audit trail
                }
            );

            // Update notification with job ID
            await notification.update({
                escalationJobId: job.id.toString(),
            });

            const escalationTime = moment().add(event.escalationDelay, event.escalationDelayUnit).format('YYYY-MM-DD HH:mm:ss');
            logger.info(`⏰ Escalation check scheduled for notification ${notification.id} at ${escalationTime} (Job: ${job.id})`);

            return {
                jobId: job.id,
                delay: delayMs,
                scheduledFor: escalationTime,
            };

        } catch (error) {
            logger.error(`❌ Error scheduling escalation check for notification ${notification.id}:`, error);
            return null;
        }
    }

    /**
     * Execute escalation check - Called by worker when job runs
     * 
     * @param {Object} jobData - { notificationId, eventId, currentLevel }
     * @returns {Promise<Object>} Escalation result
     */
    static async executeEscalationCheck(jobData) {
        try {
            const { notificationId, eventId, currentLevel } = jobData;

            logger.info(`🔍 Executing escalation check for notification ${notificationId} (Level: ${currentLevel})`);

            // Fetch original notification with full associations
            const notification = await Notification.findByPk(notificationId, {
                include: [
                    {
                        model: NotificationEvent,
                        as: 'event',
                        include: [
                            {
                                model: Tags,
                                as: 'tag',
                                attributes: ['id', 'name', 'ref', 'taggableType', 'taggableId']
                            }
                        ]
                    },
                    {
                        model: User,
                        as: 'user',
                        attributes: ['id', 'username', 'email', 'firstName', 'lastName'],
                    },
                ],
            });

            if (!notification) {
                logger.error(`❌ Notification ${notificationId} not found for escalation check`);
                return { escalated: false, error: 'notification_not_found' };
            }

            const event = notification.event;

            // Check if original user has acknowledged
            if (notification.acknowledgedAt) {
                logger.info(`✅ Notification ${notificationId} already acknowledged at ${notification.acknowledgedAt}. Cancelling escalation.`);
                return { escalated: false, reason: 'acknowledged', acknowledgedAt: notification.acknowledgedAt };
            }

            // Check if escalation is still enabled on the event
            if (!this.requiresEscalation(event)) {
                logger.info(`⚠️  Escalation no longer enabled for event ${eventId}`);
                return { escalated: false, reason: 'escalation_disabled' };
            }

            // Determine next escalation level
            const nextLevel = currentLevel + 1;

            // Check if we've reached max escalation level
            if (nextLevel > event.maxEscalationLevel || nextLevel > event.escalationUserIds.length) {
                logger.info(`⚠️  Max escalation level reached for notification ${notificationId} (Level: ${currentLevel})`);
                return { escalated: false, reason: 'max_level_reached', maxLevel: event.maxEscalationLevel };
            }

            // Get escalation user for this level (0-indexed array)
            const escalationUserId = event.escalationUserIds[nextLevel - 1];

            if (!escalationUserId) {
                logger.error(`❌ No escalation user found for level ${nextLevel}`);
                return { escalated: false, error: 'no_escalation_user' };
            }

            // Fetch escalation user
            const escalationUser = await User.findByPk(escalationUserId);

            if (!escalationUser) {
                logger.error(`❌ Escalation user ${escalationUserId} not found`);
                return { escalated: false, error: 'escalation_user_not_found' };
            }

            logger.info(`📧 Escalating notification ${notificationId} to ${escalationUser.email} (Level: ${nextLevel})`);

            // Create escalation notification
            const result = await this.createEscalationNotification(notification, event, escalationUser, nextLevel);

            return result;

        } catch (error) {
            logger.error(`❌ Error executing escalation check:`, error);
            return { escalated: false, error: error.message };
        }
    }

    /**
     * Create escalation notification for next level user
     * 
     * @param {Object} originalNotification - Original notification instance
     * @param {Object} event - NotificationEvent instance
     * @param {Object} escalationUser - User to escalate to
     * @param {Number} escalationLevel - Current escalation level
     * @returns {Promise<Object>} Created notification and escalation status
     */
    static async createEscalationNotification(originalNotification, event, escalationUser, escalationLevel) {
        try {
            // Generate secure token for email acknowledgment
            const emailToken = crypto.randomBytes(32).toString('hex'); // 64 characters
            const tokenExpiresAt = moment().add(90, 'days').toDate(); // 3 months

            // Create escalation notification (copy for awareness)
            const escalationNotification = await Notification.create({
                eventId: event.id,
                userId: escalationUser.id,
                message: originalNotification.message, // Same message as original
                tagValue: originalNotification.tagValue,
                oldTagValue: originalNotification.oldTagValue,
                isRead: false,
                notificationType: event.sendEmail ? (event.sendInApp ? 'both' : 'email') : 'in_app',
                emailSent: false,
                // Escalation tracking
                escalationLevel: escalationLevel,
                parentNotificationId: originalNotification.id, // Link to original
                emailToken: emailToken,
                tokenExpiresAt: tokenExpiresAt,
            });

            logger.info(`✅ Created escalation notification ${escalationNotification.id} for user ${escalationUser.id} (Level: ${escalationLevel})`);

            // Send email if enabled (lazy-load to avoid circular dependency)
            if (event.sendEmail) {
                const { sendEscalationEmail } = require('../../handlers/notificationEventHandler');
                await sendEscalationEmail(escalationNotification, event, escalationUser, originalNotification, escalationLevel);
            }

            // Schedule next escalation check if not at max level
            if (escalationLevel < event.maxEscalationLevel && escalationLevel < event.escalationUserIds.length) {
                await this.scheduleEscalationCheck(escalationNotification, event);
            } else {
                logger.info(`⚠️  Final escalation level reached (${escalationLevel}/${event.maxEscalationLevel})`);
            }

            return {
                escalated: true,
                escalationLevel: escalationLevel,
                escalationUserId: escalationUser.id,
                escalationUserEmail: escalationUser.email,
                notificationId: escalationNotification.id,
            };

        } catch (error) {
            logger.error(`❌ Error creating escalation notification:`, error);
            throw error;
        }
    }

    /**
     * Cancel escalation jobs when notification is acknowledged
     * 
     * @param {Number} notificationId - Original notification ID
     * @returns {Promise<Object>} Cancellation result
     */
    static async cancelEscalationJobs(notificationId) {
        try {
            logger.info(`🚫 Cancelling escalation jobs for notification ${notificationId}`);

            // Fetch original notification
            const notification = await Notification.findByPk(notificationId);

            if (!notification) {
                return { cancelled: false, error: 'notification_not_found' };
            }

            // If this notification has a pending escalation job, cancel it
            if (notification.escalationJobId) {
                const { cancelPendingJobs } = require('../queues/notificationQueue');
                const cancelled = await cancelPendingJobs(notification.escalationJobId);
                
                logger.info(`✅ Cancelled escalation job ${notification.escalationJobId} for notification ${notificationId}`);
                
                // Clear job ID
                await notification.update({ escalationJobId: null });
                
                return { cancelled: true, jobId: notification.escalationJobId };
            }

            return { cancelled: false, reason: 'no_pending_job' };

        } catch (error) {
            logger.error(`❌ Error cancelling escalation jobs:`, error);
            return { cancelled: false, error: error.message };
        }
    }
}

module.exports = EscalationService;

