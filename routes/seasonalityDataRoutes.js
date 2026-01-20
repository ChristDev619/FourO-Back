const express = require('express');
const router = express.Router();
const seasonalityDataController = require('../controllers/seasonalityData.controller');

// Get all seasonality data (optionally filtered by userId)
router.get('/', seasonalityDataController.getAllSeasonalityData);

// Get active seasonality data (optionally filtered by userId)
router.get('/active', seasonalityDataController.getActiveSeasonalityData);

// Get paginated seasonality data
router.get('/getAll/paginated', seasonalityDataController.getAllSeasonalityDataPaginated);

// Create new seasonality data
router.post('/', seasonalityDataController.createSeasonalityData);

// Get seasonality data by ID
router.get('/:id', seasonalityDataController.getSeasonalityDataById);

// Update seasonality data
router.patch('/:id', seasonalityDataController.updateSeasonalityData);

// Delete seasonality data
router.delete('/:id', seasonalityDataController.deleteSeasonalityData);

module.exports = router;

