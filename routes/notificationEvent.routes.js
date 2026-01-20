const express = require("express");
const router = express.Router();
const notificationEventController = require("../controllers/notificationEvent.controller");

// Create a new notification event
router.post("/", notificationEventController.createEvent);

// Get all notification events (with pagination)
router.get("/", notificationEventController.getAllEvents);

// Get a single notification event by ID
router.get("/:id", notificationEventController.getEventById);

// Update a notification event
router.put("/:id", notificationEventController.updateEvent);

// Delete a notification event
router.delete("/:id", notificationEventController.deleteEvent);

// Toggle event active status
router.patch("/:id/toggle", notificationEventController.toggleEventStatus);

// Get users filtered by location and/or line
router.get("/users/filter", notificationEventController.getUsersByLocationAndLine);

module.exports = router;

