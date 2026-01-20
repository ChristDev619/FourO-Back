/**
 * Notification Timestamp Formatter Utility
 * 
 * Formats notification timestamps to Date objects for consistent frontend display.
 * Follows the same pattern as Gantt chart for consistency across the application.
 * 
 * @author FourO Development Team
 * @version 1.0.0
 */

/**
 * Formats a single notification's timestamps to Date objects
 * 
 * @param {Object} notification - Sequelize notification instance or plain object
 * @returns {Object} - Formatted notification with Date objects for timestamps
 */
function formatNotificationTimestamps(notification) {
    return {
        ...notification.toJSON(),
        createdAt: new Date(notification.createdAt),
        updatedAt: new Date(notification.updatedAt),
        readAt: notification.readAt ? new Date(notification.readAt) : null,
        emailSentAt: notification.emailSentAt ? new Date(notification.emailSentAt) : null,
        acknowledgedAt: notification.acknowledgedAt ? new Date(notification.acknowledgedAt) : null,
        tokenExpiresAt: notification.tokenExpiresAt ? new Date(notification.tokenExpiresAt) : null
    };
}

/**
 * Formats an array of notifications' timestamps to Date objects
 * 
 * @param {Array} notifications - Array of Sequelize notification instances or plain objects
 * @returns {Array} - Array of formatted notifications with Date objects for timestamps
 */
function formatNotificationArray(notifications) {
    return notifications.map(formatNotificationTimestamps);
}

/**
 * Formats notification timestamps for API responses
 * Handles both single notifications and arrays automatically
 * 
 * @param {Object|Array} data - Single notification or array of notifications
 * @returns {Object|Array} - Formatted data with Date objects for timestamps
 */
function formatNotificationResponse(data) {
    if (Array.isArray(data)) {
        return formatNotificationArray(data);
    }
    return formatNotificationTimestamps(data);
}

module.exports = {
    formatNotificationTimestamps,
    formatNotificationArray,
    formatNotificationResponse
};
