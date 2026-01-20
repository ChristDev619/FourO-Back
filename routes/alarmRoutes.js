const express = require("express");
const router = express.Router();
const alarmController = require("../controllers/alarm.controller");

// Create a new alarm
router.post("/", alarmController.createAlarms);

// Retrieve all alarms
router.get("/", alarmController.getAllAlarms);

// Retrieve a single alarm by ID
router.get("/:id", alarmController.getAlarmById);

// Update an alarm by ID
router.patch("/:id", alarmController.updateAlarm);

// Delete an alarm by ID
router.delete("/:id", alarmController.deleteAlarm);

// Search alarms by name
router.get("/search/name/:name", alarmController.getAlarmByName);

// Retrieve all alarms paginated
router.get("/getAll/paginated", alarmController.getAllAlarmsPaginated);
router.get("/getAll/by-line", alarmController.getAlarmsByLine);

router.post("/upload/bulk-insert", alarmController.bulkInsertAlarms);

module.exports = router;
