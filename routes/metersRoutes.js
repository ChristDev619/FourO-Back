const express = require("express");
const router = express.Router();
const metersController = require("../controllers/meters.controller");

router.post("/", metersController.createMeter);
router.get("/", metersController.getAllMeters);
router.get("/:id", metersController.getMeterById);
router.patch("/:id", metersController.updateMeter);
router.delete("/:id", metersController.deleteMeter);
router.get("/by-location/:locationId", metersController.getMetersByLocationId);
router.get("/getAll/paginated", metersController.getAllMetersPaginated);
router.post("/All/metersByLocAndGenId", metersController.getMetersByLocIdAndGenId);
router.get("/get/All/metersByTariffTypeIdAndUnit", metersController.metersByTariffTypeIdAndUnit);


module.exports = router;
