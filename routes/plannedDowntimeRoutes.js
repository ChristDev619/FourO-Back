const express = require("express");
const router = express.Router();
const plannedDowntimeController = require("../controllers/plannedDowntime.controller");

// Create a new planned downtime
router.post("/", plannedDowntimeController.createPlannedDowntime);

// Retrieve all planned downtimes
router.get("/", plannedDowntimeController.getAllPlannedDowntimes);

// Retrieve a single planned downtime by ID
router.get("/:id", plannedDowntimeController.getPlannedDowntimeById);

// Update a planned downtime by ID
router.patch("/:id", plannedDowntimeController.updatePlannedDowntime);

// Delete a planned downtime by ID
router.delete("/:id", plannedDowntimeController.deletePlannedDowntime);

// Search planned downtimes by downtime ref ID
router.get(
  "/search/ref/:downtimeRefId",
  plannedDowntimeController.getPlannedDowntimeByRefId
);

// Search planned downtimes by reason
router.get(
  "/search/reason/:reason",
  plannedDowntimeController.getPlannedDowntimeByReason
);

// Search planned downtimes by job ref ID
router.get(
  "/search/job-ref/:jobRefId",
  plannedDowntimeController.getPlannedDowntimeByJobRefId
);

// Search planned downtimes by line ID
router.get(
  "/search/line/:lineId",
  plannedDowntimeController.getPlannedDowntimeByLineId
);

// Retrieve all planned downtimes paginated
router.get(
  "/getAll/paginated",
  plannedDowntimeController.getAllPlannedDowntimesPaginated
);

router.get("/download/template", plannedDowntimeController.downloadTemplate);
router.post(
  "/upload/bulk-insert",
  plannedDowntimeController.bulkInsertPlannedDowntimes
);

module.exports = router;
