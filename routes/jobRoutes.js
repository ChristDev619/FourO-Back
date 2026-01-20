const express = require("express");
const router = express.Router();
const jobController = require("../controllers/job.controller");

// Create a new job
router.post("/", jobController.createJob);

// Retrieve all jobs
router.get("/", jobController.getAllJobs);

// ============================================================================
// SPECIFIC ROUTES (Must come BEFORE parameterized routes like /:id)
// ============================================================================

// Retrieve all jobs paginated
router.get("/getAll/paginated", jobController.getAllJobsPaginated);

// Search jobs by ref ID
router.get("/search/ref/:jobRefId", jobController.getJobByRefId);

// Search jobs by name
router.get("/search/name/:name", jobController.getJobByName);

// Search jobs by SKU
router.get("/search/sku/:sku", jobController.getJobBySku);

// ============================================================================
// PARAMETERIZED ROUTES (Must come AFTER specific routes)
// ============================================================================

// Retrieve a single job by ID
router.get("/:id", jobController.getJobById);

// Update a job by ID
router.patch("/:id", jobController.updateJob);

// Delete a job by ID
router.delete("/:id", jobController.deleteJob);

// New route to fetch jobs by line and date range
router.get("/line/:lineId", jobController.getJobsByLineAndDate);

// New route: Get jobs by location and date range
router.get("/location/:locationId", jobController.getJobsByLocationAndDate);

router.post("/multiple-lines", jobController.getJobsByMultipleLines);

// New route: Get programs by multiple lines
router.post("/program/programsbylines", jobController.getProgramsByMultipleLines);

router.get("/program/programsbylocation", jobController.getProgramsByLocation);

router.post(
    "/upload/bulk-insert",
    jobController.bulkInsertJobs
);

router.post('/:id/confirm-merge', jobController.confirmMerge);

// Find job by program ID
router.get('/program/:id', jobController.getJobByProgramId);

// ============================================================================
// MANUAL RECALCULATION (Developer/Admin Tools)
// These must come BEFORE /:id routes to avoid route collision
// ============================================================================

/**
 * @route   POST /api/jobs/bulk-recalculate
 * @desc    Manually trigger recalculation for multiple jobs
 * @access  Admin only
 * @body    jobIds - Array of job IDs to recalculate
 * @description Bulk recalculation operation. Limited to 50 jobs per request.
 */
router.post("/bulk-recalculate", jobController.triggerBulkRecalculation);

/**
 * @route   POST /api/jobs/:id/recalculate
 * @desc    Manually trigger recalculation of aggregates for a single job
 * @access  Admin only
 * @description Queues a job for aggregate recalculation (alarms, machine states, OEE)
 *              Useful for data corrections, maintenance, or testing
 */
router.post("/:id/recalculate", jobController.triggerRecalculation);

// Check OEE data availability for a job
router.get('/:id/oee-data-status', jobController.getOeeDataStatus);

module.exports = router;
