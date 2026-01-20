const express = require("express");
const router = express.Router();
const tariffUsageController = require("../controllers/tariffUsage.controller");

router.get(
  "/getAll/paginated",
  tariffUsageController.getAllTariffUsagePaginated
);
router.post("/", tariffUsageController.createTariffUsage);
router.put("/:id", tariffUsageController.updateTariffUsage);
router.delete("/:id", tariffUsageController.deleteTariffUsage);
router.get("/date", tariffUsageController.getTariffUsageByDate);
router.get("/search", tariffUsageController.searchTariffUsageBySupplier);
router.post("/calculateConsumption", tariffUsageController.calculateConsumption);
module.exports = router;
