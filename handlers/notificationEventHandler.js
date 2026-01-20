const { NotificationEvent, Notification, User, Tags, Location, Line, sequelize, Op } = require("../dbInit");
const EmailService = require("../utils/services/EmailService");
const NotificationDurationService = require("../utils/services/NotificationDurationService");
const EscalationService = require("../utils/services/EscalationService");
const TagRefs = require("../utils/constants/TagRefs");
const STATE_CONFIG = require("../utils/stateConfig");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const moment = require("moment");

/**
 * Main function to check and trigger notifications based on tag operations
 * Called from bulk operations controllers
 * 
 * @param {Array} tagOperations - Array of {tagId, value, oldValue}
 * @param {String} operationTime - Timestamp of the operation
 */
async function checkAndTriggerNotifications(tagOperations, operationTime) {
    try {
        if (!tagOperations || tagOperations.length === 0) {
            return;
        }

        console.log(`🔔 Checking notifications for ${tagOperations.length} tag operations...`);

        // Get all tag IDs from operations
        const tagIds = tagOperations.map(t => t.tagId);

        // Fetch active notification events for these tags
        const activeEvents = await NotificationEvent.findAll({
            where: {
                tagId: { [Op.in]: tagIds },
                isActive: true
            },
            include: [
                {
                    model: Tags,
                    as: 'tag',
                    attributes: ['id', 'name', 'ref', 'taggableType', 'taggableId']
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

        if (activeEvents.length === 0) {
            console.log(`🔕 No active notification events found for these tags`);
            return;
        }

        console.log(`📋 Found ${activeEvents.length} active notification events to check`);

        // Process each event
        for (const event of activeEvents) {
            try {
                // Find the corresponding tag operation
                const tagOp = tagOperations.find(t => t.tagId === event.tagId);
                if (!tagOp) continue;

                // Check cooldown period (based on REAL-TIME, not operation time)
                // This ensures notifications respect cooldown even when processing historical data
                if (event.lastTriggeredAt) {
                    const now = moment();
                    const minutesSinceLastTrigger = now.diff(moment(event.lastTriggeredAt), 'minutes');
                    
                    if (minutesSinceLastTrigger < event.cooldownMinutes) {
                        console.log(`⏳ Event "${event.eventName}" is in cooldown (${minutesSinceLastTrigger}/${event.cooldownMinutes} minutes)`);
                        continue;
                    }
                }

                // Check if event requires duration-based handling
                if (event.conditionType === 'state_change' && NotificationDurationService.requiresDurationCheck(event)) {
                    // Handle state change with duration requirement (event-driven)
                    const result = await NotificationDurationService.handleStateChangeWithDuration(event, tagOp);
                    
                    if (result.scheduled) {
                        console.log(`⏰ Scheduled duration check for event "${event.eventName}" - will trigger after ${event.stateDuration} ${event.stateDurationUnit}`);
                    } else if (result.cancelled) {
                        console.log(`❌ Cancelled ${result.cancelled} pending jobs for event "${event.eventName}" - state exited before duration`);
                    }
                } else {
                    // Standard immediate evaluation
                    const conditionMet = evaluateCondition(event, tagOp);

                    if (conditionMet) {
                        console.log(`✅ Condition met for event "${event.eventName}"`);

                        // Get recipient users
                        const users = await getEventRecipients(event);

                        if (users.length === 0) {
                            console.log(`⚠️  No recipients found for event "${event.eventName}"`);
                            continue;
                        }

                        // Create notifications and send
                        await createNotificationsForEvent(event, users, tagOp, operationTime);

                        // Update last triggered timestamp (use real-time, not operation time)
                        await event.update({ lastTriggeredAt: moment().format('YYYY-MM-DD HH:mm:ss') });

                        console.log(`📬 Sent notifications to ${users.length} users for event "${event.eventName}"`);
                    } else {
                        console.log(`❌ Condition not met for event "${event.eventName}"`);
                    }
                }
            } catch (eventError) {
                console.error(`❌ Error processing event ${event.id} (${event.eventName}):`, eventError.message);
                // Continue with other events
            }
        }

    } catch (error) {
        console.error("❌ Error in checkAndTriggerNotifications:", error);
        // Don't throw - we don't want to break bulk operations
    }
}

/**
 * Evaluate if the condition is met for an event
 * @param {Object} event - NotificationEvent object
 * @param {Object} tagOp - {tagId, value, oldValue}
 * @returns {Boolean}
 */
function evaluateCondition(event, tagOp) {
    const { conditionType, thresholdValue, comparisonOperator, targetState } = event;
    const { value, oldValue } = tagOp;

    switch (conditionType) {
        case 'value_change':
            // Trigger when value changes
            // Convert both values to strings for consistent comparison
            // IMPORTANT: Handle null/undefined separately, and use != null to check for existence (includes 0)
            const newValueStr = (value != null) ? String(value) : '';
            const oldValueStr = (oldValue != null) ? String(oldValue) : '';
            const hasChanged = newValueStr !== oldValueStr;
            
            console.log(`🔍 DEBUG: Evaluating value_change for event ${event.id} (${event.eventName})`);
            console.log(`🔍 DEBUG: tagId=${tagOp.tagId}, value=${value} (type: ${typeof value}), oldValue=${oldValue} (type: ${typeof oldValue})`);
            console.log(`🔍 DEBUG: newValueStr="${newValueStr}", oldValueStr="${oldValueStr}"`);
            console.log(`🔍 DEBUG: hasChanged: ${hasChanged}`);
            
            return hasChanged;

        case 'threshold':
            // Trigger when value meets threshold condition
            if (!thresholdValue || !comparisonOperator) {
                console.warn(`⚠️  Event ${event.id} has threshold condition but missing thresholdValue or operator`);
                return false;
            }
            return compareWithOperator(
                parseFloat(value),
                parseFloat(thresholdValue),
                comparisonOperator
            );

        case 'state_change':
            // Trigger when state changes to a specific target state
            if (!targetState) {
                console.warn(`⚠️  Event ${event.id} has state_change condition but missing targetState`);
                return false;
            }
            
            // Check if state changed to target state
            const stateChangedToTarget = (value !== oldValue) && (value.toString() === targetState.toString());
            
            // If event has duration requirement, don't trigger immediately
            // The duration service will handle scheduling the delayed check
            if (stateChangedToTarget && NotificationDurationService.requiresDurationCheck(event)) {
                console.log(`⏰ State changed to ${targetState} with duration requirement - will schedule delayed check`);
                return false; // Don't trigger now - will be handled by scheduleDurationChecks
            }
            
            // No duration requirement - trigger immediately
            return stateChangedToTarget;

        default:
            console.warn(`⚠️  Unknown condition type: ${conditionType}`);
            return false;
    }
}

/**
 * Compare values using operator
 * @param {Number} value - Current value
 * @param {Number} threshold - Threshold value
 * @param {String} operator - Comparison operator
 * @returns {Boolean}
 */
function compareWithOperator(value, threshold, operator) {
    switch (operator) {
        case '>': return value > threshold;
        case '<': return value < threshold;
        case '=': return value === threshold;
        case '>=': return value >= threshold;
        case '<=': return value <= threshold;
        case '!=': return value !== threshold;
        default: return false;
    }
}

/**
 * Get recipient users for an event based on filters
 * @param {Object} event - NotificationEvent object
 * @returns {Array} Array of User objects
 */
async function getEventRecipients(event) {
    try {
        const { selectedUsers, filterByLocationId, filterByLineId } = event;

        // If specific users are selected, fetch only those
        if (selectedUsers && selectedUsers.length > 0) {
            const users = await User.findAll({
                where: {
                    id: { [Op.in]: selectedUsers }
                },
                attributes: ['id', 'username', 'email', 'firstName', 'lastName'],
                include: [
                    {
                        model: Location,
                        as: 'location',
                        required: false,
                        attributes: ['id', 'name']
                    }
                ]
            });
            return users;
        }

        // If location filter is specified, get users from that location
        if (filterByLocationId) {
            const users = await User.findAll({
                where: {
                    locationId: filterByLocationId
                },
                attributes: ['id', 'username', 'email', 'firstName', 'lastName']
            });
            return users;
        }

        // If line filter is specified, get users from location that owns that line
        if (filterByLineId) {
            const line = await Line.findByPk(filterByLineId, {
                include: [{
                    model: Location,
                    as: 'location',
                    attributes: ['id']
                }]
            });

            if (line && line.location) {
                const users = await User.findAll({
                    where: {
                        locationId: line.location.id
                    },
                    attributes: ['id', 'username', 'email', 'firstName', 'lastName']
                });
                return users;
            }
        }

        // No filters - return empty array (don't notify everyone)
        console.warn(`⚠️  Event ${event.id} has no recipient filters`);
        return [];

    } catch (error) {
        console.error("Error getting event recipients:", error);
        return [];
    }
}

/**
 * Create notification records and send emails
 * @param {Object} event - NotificationEvent object
 * @param {Array} users - Array of User objects
 * @param {Object} tagOp - {tagId, value, oldValue}
 * @param {String} operationTime - Timestamp
 */
async function createNotificationsForEvent(event, users, tagOp, operationTime) {
    try {
        const { value, oldValue } = tagOp;

        // Format the message by replacing placeholders
        let message = event.description;
        message = message.replace(/\{\{value\}\}/g, value);
        message = message.replace(/\{\{oldValue\}\}/g, oldValue || 'N/A');
        message = message.replace(/\{\{newValue\}\}/g, value);

        // Determine notification type
        let notificationType = 'both';
        if (event.sendEmail && !event.sendInApp) {
            notificationType = 'email';
        } else if (!event.sendEmail && event.sendInApp) {
            notificationType = 'in_app';
        }

        // Create notification records for all users
        // Generate email tokens for acknowledgment (3 months expiry)
        const tokenExpiresAt = moment().add(90, 'days').toDate();
        
        const notificationRecords = users.map(user => ({
            eventId: event.id,
            userId: user.id,
            message: message,
            tagValue: value.toString(),
            oldTagValue: oldValue ? oldValue.toString() : null,
            isRead: false,
            notificationType: notificationType,
            emailSent: false,
            emailToken: crypto.randomBytes(32).toString('hex'), // 64-char hex token
            tokenExpiresAt: tokenExpiresAt,
            escalationLevel: 0, // Original notifications
            parentNotificationId: null,
            createdAt: operationTime,
            updatedAt: operationTime
        }));

        const createdNotifications = await Notification.bulkCreate(notificationRecords);

        console.log(`✅ Created ${createdNotifications.length} notification records`);

        // Send emails if enabled
        if (event.sendEmail) {
            await sendEmailNotifications(event, createdNotifications, message, tagOp);
        }
        
        // Schedule escalation checks if enabled (after notifications are created)
        if (EscalationService.requiresEscalation(event)) {
            for (const notification of createdNotifications) {
                await EscalationService.scheduleEscalationCheck(notification, event);
            }
            console.log(`⏰ Scheduled escalation checks for ${createdNotifications.length} notifications`);
        }

        // Send WebSocket notifications if enabled
        if (event.sendInApp) {
            await sendWebSocketNotifications(createdNotifications, users, message);
        }

    } catch (error) {
        console.error("Error creating notifications:", error);
        throw error;
    }
}

/**
 * Send email notifications to users
 * @param {Object} event - NotificationEvent object
 * @param {Array} users - Array of User objects
 * @param {String} message - Formatted message
 * @param {Object} tagOp - {tagId, value, oldValue}
 */
async function sendEmailNotifications(event, createdNotifications, message, tagOp) {
    try {
        // Get API URL for acknowledge links
        const API_URL = process.env.API_URL || 'http://localhost:8011';
        
        // Load email template
        const templatePath = path.join(__dirname, '../templates/email/notification-alert.html');
        let emailTemplate = '';

        if (fs.existsSync(templatePath)) {
            emailTemplate = fs.readFileSync(templatePath, 'utf-8');
        } else {
            // Fallback simple template
            emailTemplate = `
                <h2>{{eventName}}</h2>
                <p>{{message}}</p>
                <hr>
                <p><strong>Tag:</strong> {{tagName}}</p>
                <p><strong>Current Value:</strong> {{valueDisplay}}</p>
                <p><strong>Previous Value:</strong> {{oldValueDisplay}}</p>
                <p><strong>Time:</strong> {{timestamp}}</p>
                <br>
                <a href="{{acknowledgeUrl}}" style="padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 6px;">Acknowledge</a>
            `;
        }

        // Format values based on tag type
        let valueDisplay = tagOp.value.toString();
        let oldValueDisplay = tagOp.oldValue ? tagOp.oldValue.toString() : 'N/A';
        
        // Check if this is a MACHINE_STATE tag - display state name with color
        const isMachineState = event.tag.ref === TagRefs.MACHINE_STATE;
        
        if (isMachineState) {
            // Convert numeric state codes to colored state labels
            const currentStateCode = parseInt(tagOp.value);
            const previousStateCode = tagOp.oldValue ? parseInt(tagOp.oldValue) : null;
            
            const currentStateLabel = STATE_CONFIG.getStateLabel(currentStateCode);
            const currentStateColor = STATE_CONFIG.getStateColorByCode(currentStateCode);
            
            // Format current value with colored badge
            valueDisplay = `
                <span style="display: inline-flex; align-items: center; gap: 8px;">
                    <span style="
                        display: inline-block;
                        width: 12px;
                        height: 12px;
                        border-radius: 50%;
                        background-color: ${currentStateColor};
                        box-shadow: 0 0 4px ${currentStateColor};
                    "></span>
                    <strong style="color: ${currentStateColor};">${currentStateLabel}</strong>
                    <span style="
                        background-color: rgba(0,0,0,0.08);
                        padding: 2px 8px;
                        border-radius: 4px;
                        font-family: monospace;
                        font-size: 12px;
                        color: #666;
                    ">(${currentStateCode})</span>
                </span>
            `;
            
            // Format previous value if exists
            if (previousStateCode !== null && !isNaN(previousStateCode)) {
                const previousStateLabel = STATE_CONFIG.getStateLabel(previousStateCode);
                const previousStateColor = STATE_CONFIG.getStateColorByCode(previousStateCode);
                
                oldValueDisplay = `
                    <span style="display: inline-flex; align-items: center; gap: 8px;">
                        <span style="
                            display: inline-block;
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            background-color: ${previousStateColor};
                            box-shadow: 0 0 4px ${previousStateColor};
                        "></span>
                        <strong style="color: ${previousStateColor};">${previousStateLabel}</strong>
                        <span style="
                            background-color: rgba(0,0,0,0.08);
                            padding: 2px 8px;
                            border-radius: 4px;
                            font-family: monospace;
                            font-size: 12px;
                            color: #666;
                        ">(${previousStateCode})</span>
                    </span>
                `;
            }
        }

        // Send emails to all notifications using Azure Email Service
        // Each notification has a unique token for acknowledgment
        const emailPromises = createdNotifications.map(async (notification) => {
            // Fetch user details (notifications only have userId)
            const user = await User.findByPk(notification.userId, {
                attributes: ['id', 'username', 'email', 'firstName', 'lastName']
            });
            
            if (!user || !user.email) {
                console.warn(`⚠️  User ${notification.userId} not found or has no email address`);
                return;
            }

            // Generate acknowledge URL with unique token
            const acknowledgeUrl = `${API_URL}/api/notifications/acknowledge/${notification.emailToken}`;

            // Replace placeholders in template (create copy for each user)
            let personalizedEmail = emailTemplate;
            personalizedEmail = personalizedEmail.replace(/\{\{eventName\}\}/g, event.eventName);
            personalizedEmail = personalizedEmail.replace(/\{\{message\}\}/g, message);
            personalizedEmail = personalizedEmail.replace(/\{\{tagName\}\}/g, event.tag.name);
            personalizedEmail = personalizedEmail.replace(/\{\{valueDisplay\}\}/g, valueDisplay);
            personalizedEmail = personalizedEmail.replace(/\{\{oldValueDisplay\}\}/g, oldValueDisplay);
            // Keep backward compatibility with old template placeholders
            personalizedEmail = personalizedEmail.replace(/\{\{value\}\}/g, valueDisplay);
            personalizedEmail = personalizedEmail.replace(/\{\{oldValue\}\}/g, oldValueDisplay);
            personalizedEmail = personalizedEmail.replace(/\{\{timestamp\}\}/g, moment().format('YYYY-MM-DD HH:mm:ss'));
            // New placeholders for acknowledgment
            personalizedEmail = personalizedEmail.replace(/\{\{acknowledgeUrl\}\}/g, acknowledgeUrl);
            personalizedEmail = personalizedEmail.replace(/\{\{emailToken\}\}/g, notification.emailToken);
            
            // Escalation warning section (if applicable)
            let escalationWarningSection = '';
            if (event.enableEscalation && event.escalationDelay) {
                const escalationUserEmails = await User.findAll({
                    where: { id: { [Op.in]: event.escalationUserIds || [] } },
                    attributes: ['email']
                });
                const escalationEmails = escalationUserEmails.map(u => u.email).join(', ');
                const escalationMessage = `If not acknowledged within ${event.escalationDelay} ${event.escalationDelayUnit}, this will be escalated to: ${escalationEmails}`;
                
                // Generate full HTML for escalation warning
                escalationWarningSection = `
                    <div style="background: #fff3cd; 
                                border-left: 4px solid #ffc107; 
                                padding: 15px; 
                                margin: 20px 0; 
                                border-radius: 4px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 24px;">⚠️</span>
                            <div>
                                <strong style="color: #856404; display: block; margin-bottom: 5px;">Escalation Enabled</strong>
                                <p style="margin: 0; font-size: 14px; color: #856404;">
                                    ${escalationMessage}
                                </p>
                            </div>
                        </div>
                    </div>
                `;
            }
            personalizedEmail = personalizedEmail.replace(/\{\{escalationWarningSection\}\}/g, escalationWarningSection);

            try {
                const result = await EmailService.sendEmail({
                    to: user.email,
                    subject: `🔔 FourO Alert: ${event.eventName}`,
                    htmlContent: personalizedEmail,
                    metadata: {
                        type: 'notification_alert',
                        eventId: event.id,
                        userId: user.id,
                        tagId: event.tagId,
                        notificationId: notification.id,
                        escalationLevel: notification.escalationLevel
                    }
                });

                if (result.success) {
                    console.log(`📧 Email sent to ${user.email}`);
                    // Update notification record
                    await Notification.update(
                        { emailSent: true, emailSentAt: new Date() },
                        { where: { eventId: event.id, userId: user.id, emailSent: false } }
                    );
                } else {
                    console.error(`❌ Failed to send email to ${user.email}:`, result.error || result.message);
                }
            } catch (emailError) {
                console.error(`❌ Failed to send email to ${user.email}:`, emailError.message);
            }
        });

        await Promise.allSettled(emailPromises);

    } catch (error) {
        console.error("Error sending email notifications:", error);
        // Don't throw - continue with in-app notifications
    }
}

/**
 * Send WebSocket notifications to connected users
 * @param {Array} notifications - Array of created Notification objects
 * @param {Array} users - Array of User objects
 * @param {String} message - Formatted message
 */
async function sendWebSocketNotifications(notifications, users, message) {
    try {
        // Get Redis publisher (if available)
        const { getSharedPublisher } = require("../utils/redisConfig");
        const publisher = await getSharedPublisher();

        if (!publisher) {
            console.warn("⚠️  Redis publisher not available - WebSocket notifications skipped");
            return;
        }

        // Send notification to each user via Redis pub/sub
        for (const user of users) {
            const notificationData = {
                type: 'notification',
                userId: user.id,
                message: message,
                timestamp: new Date().toISOString(),
                notificationId: notifications.find(n => n.userId === user.id)?.id
            };

            await publisher.publish('notifications', JSON.stringify(notificationData));
            console.log(`📡 WebSocket notification sent to user ${user.id}`);
        }

    } catch (error) {
        console.error("Error sending WebSocket notifications:", error);
        // Don't throw - notifications are already in database
    }
}

/**
 * Send escalation email
 * Called by EscalationService when escalating notifications
 * 
 * @param {Object} notification - Escalation notification instance
 * @param {Object} event - NotificationEvent instance
 * @param {Object} user - Escalation user instance
 * @param {Object} originalNotification - Original notification instance
 * @param {Number} escalationLevel - Current escalation level
 */
async function sendEscalationEmail(notification, event, user, originalNotification, escalationLevel) {
    try {
        // Get API URL for acknowledge links
        const API_URL = process.env.API_URL || 'http://localhost:8011';
        
        // Load email template
        const templatePath = path.join(__dirname, '../templates/email/notification-alert.html');
        let emailTemplate = fs.readFileSync(templatePath, 'utf-8');
        
        // Format values based on tag type (same logic as sendEmailNotifications)
        let valueDisplay = notification.tagValue;
        let oldValueDisplay = notification.oldTagValue || 'N/A';
        
        // Check if this is a MACHINE_STATE tag
        if (event.tag && event.tag.ref === TagRefs.MACHINE_STATE) {
            const currentStateCode = parseInt(notification.tagValue);
            const previousStateCode = notification.oldTagValue ? parseInt(notification.oldTagValue) : null;
            
            const currentStateLabel = STATE_CONFIG.getStateLabel(currentStateCode);
            const currentStateColor = STATE_CONFIG.getStateColorByCode(currentStateCode);
            
            valueDisplay = `
                <span style="display: inline-flex; align-items: center; gap: 8px;">
                    <span style="
                        display: inline-block;
                        width: 12px;
                        height: 12px;
                        border-radius: 50%;
                        background-color: ${currentStateColor};
                        box-shadow: 0 0 4px ${currentStateColor};
                    "></span>
                    <strong style="color: ${currentStateColor};">${currentStateLabel}</strong>
                    <span style="
                        background-color: rgba(0,0,0,0.08);
                        padding: 2px 8px;
                        border-radius: 4px;
                        font-family: monospace;
                        font-size: 12px;
                        color: #666;
                    ">(${currentStateCode})</span>
                </span>
            `;
            
            if (previousStateCode !== null && !isNaN(previousStateCode)) {
                const previousStateLabel = STATE_CONFIG.getStateLabel(previousStateCode);
                const previousStateColor = STATE_CONFIG.getStateColorByCode(previousStateCode);
                
                oldValueDisplay = `
                    <span style="display: inline-flex; align-items: center; gap: 8px;">
                        <span style="
                            display: inline-block;
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            background-color: ${previousStateColor};
                            box-shadow: 0 0 4px ${previousStateColor};
                        "></span>
                        <strong style="color: ${previousStateColor};">${previousStateLabel}</strong>
                        <span style="
                            background-color: rgba(0,0,0,0.08);
                            padding: 2px 8px;
                            border-radius: 4px;
                            font-family: monospace;
                            font-size: 12px;
                            color: #666;
                        ">(${previousStateCode})</span>
                    </span>
                `;
            }
        }
        
        // Generate acknowledge URL
        const acknowledgeUrl = `${API_URL}/api/notifications/acknowledge/${notification.emailToken}`;
        
        // Replace placeholders
        let personalizedEmail = emailTemplate;
        personalizedEmail = personalizedEmail.replace(/\{\{eventName\}\}/g, event.eventName);
        personalizedEmail = personalizedEmail.replace(/\{\{message\}\}/g, notification.message);
        personalizedEmail = personalizedEmail.replace(/\{\{tagName\}\}/g, event.tag?.name || 'Unknown Tag');
        personalizedEmail = personalizedEmail.replace(/\{\{valueDisplay\}\}/g, valueDisplay);
        personalizedEmail = personalizedEmail.replace(/\{\{oldValueDisplay\}\}/g, oldValueDisplay);
        personalizedEmail = personalizedEmail.replace(/\{\{value\}\}/g, valueDisplay);
        personalizedEmail = personalizedEmail.replace(/\{\{oldValue\}\}/g, oldValueDisplay);
        personalizedEmail = personalizedEmail.replace(/\{\{timestamp\}\}/g, moment().format('YYYY-MM-DD HH:mm:ss'));
        personalizedEmail = personalizedEmail.replace(/\{\{acknowledgeUrl\}\}/g, acknowledgeUrl);
        personalizedEmail = personalizedEmail.replace(/\{\{emailToken\}\}/g, notification.emailToken);
        personalizedEmail = personalizedEmail.replace(/\{\{escalationWarningSection\}\}/g, ''); // No escalation warning in escalated emails
        
        // Send escalation email
        const result = await EmailService.sendEmail({
            to: user.email,
            subject: `⚠️ ESCALATED (Level ${escalationLevel}): ${event.eventName}`,
            htmlContent: personalizedEmail,
            metadata: {
                type: 'notification_escalation',
                eventId: event.id,
                userId: user.id,
                notificationId: notification.id,
                escalationLevel: escalationLevel,
                originalNotificationId: originalNotification.id
            }
        });
        
        if (result.success) {
            console.log(`📧 Escalation email sent to ${user.email} (Level ${escalationLevel})`);
            // Update notification record
            await Notification.update(
                { emailSent: true, emailSentAt: new Date() },
                { where: { id: notification.id } }
            );
        } else {
            console.error(`❌ Failed to send escalation email to ${user.email}`);
        }
        
        return result;
        
    } catch (error) {
        console.error('Error sending escalation email:', error);
        throw error;
    }
}

module.exports = {
    checkAndTriggerNotifications,
    evaluateCondition,
    getEventRecipients,
    createNotificationsForEvent,
    sendEscalationEmail,
};

