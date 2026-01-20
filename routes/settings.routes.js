const express = require("express");
const router = express.Router();
const settingsController = require("../controllers/SettingsController");

// Get cost per man hour
router.get("/cost-per-man-hour", settingsController.getCostPerManHour);

// Update cost per man hour
router.put("/cost-per-man-hour", settingsController.updateCostPerManHour);

module.exports = router;

