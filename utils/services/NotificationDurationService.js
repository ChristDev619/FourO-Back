/**
 * Notification Duration Service
 * 
 * SOLID Principles:
 * - Single Responsibility: Handles ONLY duration-based notification logic
 * - Open/Closed: Can extend with new duration strategies without modifying core
 * - Dependency Inversion: Depends on abstractions (queue, converter)
 * 
 * Event-Driven Pattern:
 * - Schedules delayed jobs when state enters target
 * - Validates state persistence when job executes
 * - Triggers notification only if all conditions met
 * 
 * @module NotificationDurationService
 */

// Lazy-load queue functions to avoid circular dependency
// (notificationQueue will be imported when methods are called, not at module load)
const { toMilliseconds, hasElapsed, validateDuration } = require('../helpers/durationConverter');
const { NotificationEvent, Tags } = require('../../dbInit');
const moment = require('moment');

class NotificationDurationService {
    /**
     * Handle state change for an event with duration requirement
     * 
     * @param {Object} event - NotificationEvent model instance
     * @param {Object} tagOperation - {tagId, value, oldValue}
     * @returns {Promise<Object>} Result with scheduled flag
     */
    static async handleStateChangeWithDuration(event, tagOperation) {
        try {
            const { stateDuration, stateDurationUnit, tagId, targetState } = event;
            const { value, oldValue } = tagOperation;

            // Validate duration configuration
            const validation = validateDuration(stateDuration, stateDurationUnit);
            if (!validation.valid) {
                console.error(`❌ Invalid duration configuration for event ${event.id}:`, validation.error);
                return { scheduled: false, error: validation.error };
            }

            // Check if state changed TO the target state
            const enteredTargetState = (value !== oldValue) && (value.toString() === targetState.toString());
            
            if (enteredTargetState) {
                // State just entered target - schedule delayed check
                return await this.scheduleDurationCheck(event, tagOperation);
            } else if (oldValue.toString() === targetState.toString() && value.toString() !== targetState.toString()) {
                // State exited target before duration completed - cancel pending jobs
                console.log(`⚠️  State exited ${targetState} before duration elapsed`);
                const { cancelPendingJobs } = require('../queues/notificationQueue');
                const cancelled = await cancelPendingJobs(event.id, tagId);
                return { scheduled: false, cancelled: cancelled, reason: 'state_exited' };
            }

            return { scheduled: false, reason: 'no_state_change' };

        } catch (error) {
            console.error(`❌ Error in handleStateChangeWithDuration for event ${event.id}:`, error);
            return { scheduled: false, error: error.message };
        }
    }

    /**
     * Schedule a duration check job
     * 
     * @param {Object} event - NotificationEvent model instance
     * @param {Object} tagOperation - {tagId, value, oldValue}
     * @returns {Promise<Object>} Result with job details
     */
    static async scheduleDurationCheck(event, tagOperation) {
        try {
            const { stateDuration, stateDurationUnit, id: eventId, tagId, targetState } = event;
            
            // Convert duration to milliseconds
            const delayMs = toMilliseconds(stateDuration, stateDurationUnit);
            
            // Prepare job data
            const jobData = {
                eventId: eventId,
                tagId: tagId,
                expectedState: targetState,
                duration: stateDuration,
                durationUnit: stateDurationUnit,
                enteredAt: new Date().toISOString(),
                oldValue: tagOperation.oldValue,
            };

            // Lazy-load queue function to avoid circular dependency
            const { scheduleDurationCheck, JOB_TYPES } = require('../queues/notificationQueue');
            
            // Schedule the job
            const job = await scheduleDurationCheck(JOB_TYPES.CHECK_DURATION, jobData, { delay: delayMs });
            
            console.log(`✅ Scheduled duration check for event ${eventId} (tag ${tagId}) - will check in ${stateDuration} ${stateDurationUnit}`);
            
            return {
                scheduled: true,
                jobId: job.id,
                delayMs: delayMs,
                executeAt: new Date(Date.now() + delayMs).toISOString(),
            };

        } catch (error) {
            console.error(`❌ Error scheduling duration check for event ${event.id}:`, error);
            return { scheduled: false, error: error.message };
        }
    }

    /**
     * Execute duration check (called by worker)
     * Verifies state has persisted for required duration
     * 
     * @param {Object} jobData - Job data from Bull queue
     * @returns {Promise<Object>} Result indicating if notification should trigger
     */
    static async executeDurationCheck(jobData) {
        try {
            const { eventId, tagId, expectedState, enteredAt, duration, durationUnit } = jobData;
            
            console.log(`🔍 Executing duration check for event ${eventId}, tag ${tagId}`);

            // Fetch current event state (check if still active)
            const event = await NotificationEvent.findByPk(eventId);
            if (!event) {
                console.warn(`⚠️  Event ${eventId} not found - may have been deleted`);
                return { triggered: false, reason: 'event_not_found' };
            }

            if (!event.isActive) {
                console.log(`⚠️  Event ${eventId} is no longer active`);
                return { triggered: false, reason: 'event_inactive' };
            }

            // Fetch current tag value
            const tag = await Tags.findByPk(tagId);
            if (!tag) {
                console.warn(`⚠️  Tag ${tagId} not found`);
                return { triggered: false, reason: 'tag_not_found' };
            }

            // Check if state is STILL the expected state
            const currentState = tag.currentValue?.toString();
            if (currentState !== expectedState.toString()) {
                console.log(`❌ State changed: expected ${expectedState}, got ${currentState}`);
                return { triggered: false, reason: 'state_changed', expectedState, currentState };
            }

            // Verify duration has fully elapsed (safety check)
            const durationElapsed = hasElapsed(new Date(enteredAt), duration, durationUnit);
            if (!durationElapsed) {
                console.warn(`⚠️  Duration has not fully elapsed yet (should not happen)`);
                return { triggered: false, reason: 'duration_not_elapsed' };
            }

            // Check cooldown period
            if (event.lastTriggeredAt) {
                const minutesSinceLast = moment().diff(moment(event.lastTriggeredAt), 'minutes');
                if (minutesSinceLast < event.cooldownMinutes) {
                    console.log(`⏳ Event ${eventId} still in cooldown (${minutesSinceLast}/${event.cooldownMinutes} min)`);
                    return { triggered: false, reason: 'cooldown', minutesRemaining: event.cooldownMinutes - minutesSinceLast };
                }
            }

            // All conditions met - ready to trigger!
            console.log(`✅ All conditions met for event ${eventId} - state ${expectedState} persisted for ${duration} ${durationUnit}`);
            
            return {
                triggered: true,
                eventId: eventId,
                tagId: tagId,
                state: expectedState,
                duration: duration,
                durationUnit: durationUnit,
                enteredAt: enteredAt,
                verifiedAt: new Date().toISOString(),
            };

        } catch (error) {
            console.error(`❌ Error executing duration check:`, error);
            return { triggered: false, error: error.message };
        }
    }

    /**
     * Check if an event has duration requirement
     * 
     * @param {Object} event - NotificationEvent model instance
     * @returns {boolean} True if event requires duration check
     */
    static requiresDurationCheck(event) {
        return (
            event.conditionType === 'state_change' &&
            event.stateDuration &&
            event.stateDuration > 0 &&
            event.stateDurationUnit
        );
    }

    /**
     * Get readable status for a duration check
     * 
     * @param {Object} result - Result from executeDurationCheck
     * @returns {string} Human-readable status
     */
    static getStatusMessage(result) {
        if (result.triggered) {
            return `Notification triggered - state persisted for ${result.duration} ${result.durationUnit}`;
        }

        const reasonMessages = {
            event_not_found: 'Event no longer exists',
            event_inactive: 'Event has been deactivated',
            tag_not_found: 'Tag no longer exists',
            state_changed: `State changed from ${result.expectedState} to ${result.currentState}`,
            duration_not_elapsed: 'Duration has not fully elapsed',
            cooldown: `Still in cooldown period (${result.minutesRemaining} minutes remaining)`,
        };

        return reasonMessages[result.reason] || `Not triggered: ${result.reason}`;
    }
}

module.exports = NotificationDurationService;

