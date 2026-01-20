const express = require("express");
const router = express.Router();
const dataGapInspectorController = require("../controllers/dataGapInspector.controller");

/**
 * @route POST /api/data-gap-inspector/analyze
 * @desc Analyze data gaps for a specific line over a date range
 * @access Private (requires authentication)
 */
router.post("/analyze", dataGapInspectorController.analyzeDataGaps);

/**
 * @route GET /api/data-gap-inspector/line-tags/:lineId
 * @desc Get all tags monitored for a specific line
 * @access Private (requires authentication)
 */
router.get("/line-tags/:lineId", dataGapInspectorController.getLineTagDetails);

module.exports = router;

