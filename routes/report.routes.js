const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');

// Existing routes
router.post('/', reportController.createReport);
router.get('/', reportController.getAllReports);

// NEW: Level-based report access routes (MUST be before /:id routes)
router.get('/admin/all', reportController.getAllReportsForLevelManagement);
router.get('/level/:levelId', reportController.getReportsByLevelId);

// NEW: Favorite routes (MUST be before /:id routes)
router.get('/favorites/all', reportController.getFavoriteReports);

// User and parameterized routes
router.get('/user/:userId', reportController.getReportsByUserId);
router.get('/:id', reportController.getReportById);
router.get('/:id/data', reportController.getReportData);
router.get('/:id/data/live', reportController.getLiveReportData); // NEW: Live report endpoint for running jobs
router.get('/:id/skus', reportController.getAvailableSkus);
router.put('/:id', reportController.updateReport);
router.put('/reorder', reportController.reorderReports);
router.put('/:id/favorite', reportController.toggleReportFavorite);
router.put('/:id/volume-of-diesel', reportController.updateVolumeOfDiesel);
router.put('/:id/man-hours', reportController.updateManHours);
router.delete('/:id', reportController.deleteReport);

module.exports = router;