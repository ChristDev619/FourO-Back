const express = require("express");
const router = express.Router();
const designSpeedController = require("../controllers/designSpeed.controller");

router.get("/", designSpeedController.getAllDesignSpeeds);
router.get(
  "/machine/:machineId",
  designSpeedController.getDesignSpeedsByMachineId
);
router.get('/by-machine/:machineId', designSpeedController.getDesignSpeedsByMachineId);

module.exports = router;
