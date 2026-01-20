const express = require('express');
const router = express.Router();
const monthlyForecastController = require('../controllers/monthlyForecast.controller');

// Get all forecasts (optionally filtered by userId)
router.get('/', monthlyForecastController.getAllMonthlyForecasts);

// Get active forecast (optionally filtered by userId)
router.get('/active', monthlyForecastController.getActiveMonthlyForecast);

// Get paginated forecasts
router.get('/getAll/paginated', monthlyForecastController.getAllMonthlyForecastsPaginated);

// Create new forecast
router.post('/', monthlyForecastController.createMonthlyForecast);

// Get forecast by ID
router.get('/:id', monthlyForecastController.getMonthlyForecastById);

// Update forecast
router.patch('/:id', monthlyForecastController.updateMonthlyForecast);

// Delete forecast
router.delete('/:id', monthlyForecastController.deleteMonthlyForecast);

module.exports = router;

