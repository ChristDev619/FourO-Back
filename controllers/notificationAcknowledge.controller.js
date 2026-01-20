/**
 * Notification Acknowledgment Controller
 * 
 * PUBLIC ENDPOINT - No authentication required
 * Security via unique token (64-char hex, 90-day expiration)
 * 
 * SOLID Principles:
 * - Single Responsibility: Handle ONLY email acknowledgment
 * - Open/Closed: Can extend with different acknowledgment types
 * - Liskov Substitution: Follows standard controller pattern
 * 
 * @module NotificationAcknowledgeController
 */

const { Notification, NotificationEvent, User } = require('../dbInit');
const EscalationService = require('../utils/services/EscalationService');
const logger = require('../utils/logger');
const moment = require('moment');
const fs = require('fs');
const path = require('path');

/**
 * Acknowledge notification via email token
 * 
 * PUBLIC ROUTE: GET /api/notifications/acknowledge/:token
 * 
 * @param {Request} req - Express request (params.token)
 * @param {Response} res - Express response (HTML page)
 */
const acknowledgeNotification = async (req, res) => {
    try {
        const { token } = req.params;

        // Validate token format (64-char hex)
        if (!token || token.length !== 64 || !/^[a-f0-9]{64}$/i.test(token)) {
            logger.warn(`⚠️  Invalid token format: ${token?.substring(0, 10)}...`);
            return res.status(400).send(renderErrorPage('Invalid acknowledgment link'));
        }

        // Find notification by token
        const notification = await Notification.findOne({
            where: { emailToken: token },
            include: [
                {
                    model: NotificationEvent,
                    as: 'event',
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'username', 'email', 'firstName', 'lastName'],
                },
            ],
        });

        // Check if notification exists
        if (!notification) {
            logger.warn(`⚠️  Notification not found for token: ${token.substring(0, 10)}...`);
            return res.status(404).send(renderErrorPage('Notification not found or link is invalid'));
        }

        // Check token expiration
        if (notification.tokenExpiresAt && moment().isAfter(moment(notification.tokenExpiresAt))) {
            logger.warn(`⚠️  Expired token for notification ${notification.id}`);
            return res.status(410).send(renderErrorPage('This acknowledgment link has expired (valid for 90 days)'));
        }

        // Check if already acknowledged
        if (notification.acknowledgedAt) {
            logger.info(`ℹ️  Notification ${notification.id} already acknowledged at ${notification.acknowledgedAt}`);
            return res.status(200).send(renderSuccessPage(notification, true));
        }

        // Mark as acknowledged
        await notification.update({
            acknowledgedAt: new Date(),
            isRead: true,
            readAt: new Date(),
        });

        logger.info(`✅ Notification ${notification.id} acknowledged by user ${notification.userId} via email token`);

        // Cancel escalation jobs ONLY if this is the original notification (level 0)
        if (notification.escalationLevel === 0) {
            await EscalationService.cancelEscalationJobs(notification.id);
            logger.info(`🚫 Escalation cancelled for notification ${notification.id}`);
        } else {
            logger.info(`ℹ️  Escalated notification (Level ${notification.escalationLevel}) acknowledged - does not cancel escalation chain`);
        }

        // Send success page
        return res.status(200).send(renderSuccessPage(notification, false));

    } catch (error) {
        logger.error(`❌ Error acknowledging notification:`, error);
        return res.status(500).send(renderErrorPage('An error occurred. Please try again later.'));
    }
};

/**
 * Render success HTML page
 * 
 * @param {Object} notification - Notification instance
 * @param {Boolean} alreadyAcknowledged - Was it already acknowledged?
 * @returns {String} HTML content
 */
function renderSuccessPage(notification, alreadyAcknowledged) {
    try {
        const templatePath = path.join(__dirname, '../templates/email/acknowledgment-success.html');
        let html = fs.readFileSync(templatePath, 'utf8');

        // Replace simple placeholders
        html = html.replace(/{{userName}}/g, notification.user?.firstName || notification.user?.username || 'User');
        html = html.replace(/{{eventName}}/g, notification.event?.eventName || 'Notification');
        html = html.replace(/{{acknowledgedAt}}/g, moment(notification.acknowledgedAt).format('MMMM D, YYYY [at] h:mm A'));

        // Handle Handlebars conditionals
        if (alreadyAcknowledged) {
            // Show "already acknowledged" message
            html = html.replace(/{{#if alreadyAcknowledged}}[\s\S]*?{{else}}[\s\S]*?{{\/if}}/g, 'This notification was already acknowledged.');
            // Add already-acknowledged class
            html = html.replace(/class="timestamp"/g, 'class="timestamp already-acknowledged"');
        } else {
            // Show "successfully acknowledged" message
            html = html.replace(/{{#if alreadyAcknowledged}}[\s\S]*?{{else}}[\s\S]*?{{\/if}}/g, 'Your notification has been acknowledged successfully. The escalation workflow has been cancelled.');
        }

        return html;
    } catch (error) {
        logger.error(`❌ Error rendering success page:`, error);
        // Fallback simple HTML
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Notification Acknowledged</title>
            </head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
                <div style="background: white; padding: 40px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <h1 style="color: #10b981; font-size: 48px; margin: 0;">✓</h1>
                    <h2 style="color: #333; margin: 20px 0;">Thank You!</h2>
                    <p style="color: #666; font-size: 16px; line-height: 1.6;">
                        ${alreadyAcknowledged ? 'This notification was already acknowledged.' : 'Your notification has been acknowledged successfully.'}
                    </p>
                </div>
            </body>
            </html>
        `;
    }
}

/**
 * Render error HTML page
 * 
 * @param {String} message - Error message
 * @returns {String} HTML content
 */
function renderErrorPage(message) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Acknowledgment Error</title>
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5;">
            <div style="background: white; padding: 40px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <h1 style="color: #ef4444; font-size: 48px; margin: 0;">⚠️</h1>
                <h2 style="color: #333; margin: 20px 0;">Unable to Acknowledge</h2>
                <p style="color: #666; font-size: 16px; line-height: 1.6;">
                    ${message}
                </p>
                <p style="color: #999; font-size: 14px; margin-top: 20px;">
                    If you believe this is an error, please contact support.
                </p>
            </div>
        </body>
        </html>
    `;
}

module.exports = {
    acknowledgeNotification,
};

