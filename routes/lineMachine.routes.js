const express = require("express");
const router = express.Router();
const { getMachinesByLineId } = require("../controllers/lineMachine.controller");

// Route to get machines by line ID
router.get("/:lineId/machines", getMachinesByLineId);

module.exports = router;
