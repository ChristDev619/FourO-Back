const express = require("express");
const router = express.Router();
const jobLineMachineTagController = require("../controllers/joblinemachinetag.controller");

// Route to get lines with corresponding machines
router.get(
  "/lines-with-machines",
  jobLineMachineTagController.getLinesWithMachines
);

router.get(
  "/lines-with-machines/location/:locationId",
  jobLineMachineTagController.getLinesWithMachinesByLocation
);

// Route to get distinct machine tags
router.get(
  "/distinct-machine-tags",
  jobLineMachineTagController.getDistinctMachineTags
);

// Route to get tags of a specific line
router.get("/tags-by-line/:lineId", jobLineMachineTagController.getTagsByLine);

// Route to get line tags
router.get("/line-tags", jobLineMachineTagController.getLineTags);

// Route to get lines with corresponding machines and tags
router.get(
  "/lines-with-machine-tags",
  jobLineMachineTagController.getLinesWithMachineTags
);

// Route to get machines by line ID
router.get(
  "/machines-by-line/:lineId",
  jobLineMachineTagController.getMachinesByLineId
);

// Route to get all lines
router.get("/lines", jobLineMachineTagController.getLines);

module.exports = router;
