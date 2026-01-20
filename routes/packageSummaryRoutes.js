const express = require("express");
const router = express.Router();
const packageSummaryController = require("../controllers/packageSummary.controller");

/**
 * @route   POST /api/package-summaries
 * @desc    Create a new Package Summary
 * @access  Private
 */
router.post("/", packageSummaryController.createPackageSummary);

/**
 * @route   GET /api/package-summaries
 * @desc    Get all Package Summaries
 * @access  Private
 */
router.get("/", packageSummaryController.getAllPackageSummaries);

/**
 * @route   GET /api/package-summaries/active
 * @desc    Get active Package Summary
 * @access  Private
 */
router.get("/active", packageSummaryController.getActivePackageSummary);

/**
 * @route   GET /api/package-summaries/getAll/paginated
 * @desc    Get all Package Summaries with pagination
 * @access  Private
 */
router.get("/getAll/paginated", packageSummaryController.getAllPackageSummariesPaginated);

/**
 * @route   GET /api/package-summaries/:id
 * @desc    Get Package Summary by ID
 * @access  Private
 */
router.get("/:id", packageSummaryController.getPackageSummaryById);

/**
 * @route   PATCH /api/package-summaries/:id
 * @desc    Update Package Summary
 * @access  Private
 */
router.patch("/:id", packageSummaryController.updatePackageSummary);

/**
 * @route   DELETE /api/package-summaries/:id
 * @desc    Delete Package Summary
 * @access  Private
 */
router.delete("/:id", packageSummaryController.deletePackageSummary);

module.exports = router;

