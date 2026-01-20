const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");

// Create a new dashboard
router.post("/", dashboardController.createDashboard);

// Get all dashboards
router.get("/", dashboardController.getAllDashboards);

// Get dashboards by user ID
router.get("/user/:userId", dashboardController.getDashboardsByUserId);

// Get dashboards by access level ID
router.get("/level/:levelId", dashboardController.getDashboardsByLevelId);

// Get all dashboards for level management (admin use)
router.get("/admin/all", dashboardController.getAllDashboardsForLevelManagement);

// Get dashboard by ID
router.get("/:id", dashboardController.getDashboardById);

// Update dashboard by ID
router.put("/:id", dashboardController.updateDashboard);

// Delete dashboard by ID
router.delete("/:id", dashboardController.deleteDashboard);

// Toggle dashboard favorite status
router.put("/:id/favorite", dashboardController.toggleDashboardFavorite);

module.exports = router;
