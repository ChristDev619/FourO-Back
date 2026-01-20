const express = require('express');
const router = express.Router();
const lineDataController = require('../controllers/lineData.controller');

// Get all line data (optionally filtered by userId)
router.get('/', lineDataController.getAllLineData);

// Get active line data (optionally filtered by userId)
router.get('/active', lineDataController.getActiveLineData);

// Get paginated line data
router.get('/getAll/paginated', lineDataController.getAllLineDataPaginated);

// Create new line data
router.post('/', lineDataController.createLineData);

// Get line data by ID
router.get('/:id', lineDataController.getLineDataById);

// Update line data
router.patch('/:id', lineDataController.updateLineData);

// Delete line data
router.delete('/:id', lineDataController.deleteLineData);

module.exports = router;

