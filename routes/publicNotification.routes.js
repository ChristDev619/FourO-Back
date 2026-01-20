/**
 * Public Notification Routes
 * 
 * NO AUTHENTICATION REQUIRED
 * Security: Token-based validation (64-char hex, 90-day expiry)
 * 
 * These routes handle email acknowledgment links clicked from emails.
 * Users don't need to be logged in to acknowledge notifications.
 * 
 * @module PublicNotificationRoutes
 */

const express = require('express');
const router = express.Router();
const { acknowledgeNotification } = require('../controllers/notificationAcknowledge.controller');

/**
 * @route   GET /api/notifications/acknowledge/:token
 * @desc    Acknowledge notification via email token (PUBLIC)
 * @access  Public (no auth required - token-based security)
 * @param   {String} token - 64-character hex token from email link
 * @returns {HTML} Success or error page
 */
router.get('/acknowledge/:token', acknowledgeNotification);

module.exports = router;

