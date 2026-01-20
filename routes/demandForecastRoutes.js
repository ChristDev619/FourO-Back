const express = require('express');
const router = express.Router();
const demandForecastController = require('../controllers/demandForecast.controller');

// Get all forecasts (optionally filtered by userId)
router.get('/', demandForecastController.getAllDemandForecasts);

// Get active forecast (optionally filtered by userId)
router.get('/active', demandForecastController.getActiveDemandForecast);

// Get paginated forecasts
router.get('/getAll/paginated', demandForecastController.getAllDemandForecastsPaginated);

// Create new forecast
router.post('/', demandForecastController.createDemandForecast);

// Get forecast by ID
router.get('/:id', demandForecastController.getDemandForecastById);

// Update forecast
router.patch('/:id', demandForecastController.updateDemandForecast);

// Delete forecast
router.delete('/:id', demandForecastController.deleteDemandForecast);

module.exports = router;

