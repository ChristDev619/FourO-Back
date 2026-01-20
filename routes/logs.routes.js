const express = require('express');
const router = express.Router();
const logsController = require('../controllers/logs.controller');
const { correlationMiddleware } = require('../middlewares/correlationMiddleware');

// Apply correlation middleware to all log routes
router.use(correlationMiddleware);

/**
 * @route   POST /api/logs/frontend
 * @desc    Receive frontend logs with correlation ID
 * @access  Public
 */
router.post('/frontend', logsController.receiveFrontendLog);

/**
 * @route   GET /api/logs/correlation/:correlationId
 * @desc    Get logs by correlation ID
 * @access  Private (Admin only)
 */
router.get('/correlation/:correlationId', logsController.getLogsByCorrelationId);

/**
 * @route   GET /api/logs/user/:userId/errors
 * @desc    Get user error summary
 * @access  Private (Admin only)
 */
router.get('/user/:userId/errors', logsController.getUserErrorSummary);

module.exports = router;
