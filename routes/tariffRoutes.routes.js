const express = require("express");
const tariffController = require("../controllers/tariffController.controller");

const router = express.Router();

router.post("", tariffController.createTariff);
router.get("/getAll", tariffController.getAllTariffs);
router.get("/getAll/paginated", tariffController.getAllTariffsPaginated); // New route for pagination
router.get("/:id", tariffController.getTariffById);
router.get("/date/:date", tariffController.getTariffsByDate); // New route to get tariffs by date
router.put("/:id", tariffController.updateTariff);
router.delete("/:id", tariffController.deleteTariff);

module.exports = router;
