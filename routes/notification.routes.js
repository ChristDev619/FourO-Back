const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");

// Get all notifications for a user
router.get("/user/:userId", notificationController.getUserNotifications);

// Get notification history with date range and filters
router.get("/user/:userId/history", notificationController.getNotificationHistory);

// Get unread notification count for a user
router.get("/user/:userId/unread-count", notificationController.getUnreadCount);

// Mark a notification as read
router.patch("/:id/read", notificationController.markAsRead);

// Mark all notifications as read for a user
router.patch("/user/:userId/read-all", notificationController.markAllAsRead);

// Delete functionality removed - notifications should never be deleted (history is permanent)

module.exports = router;

