// routes/unitRoutes.js
const express = require("express");
const router = express.Router();
const unitController = require("../controllers/unitController");

router.post("/", unitController.createUnit);
router.get("/", unitController.getAllUnits);
router.get("/:id", unitController.getUnitById);
router.put("/:id", unitController.updateUnit);
router.delete("/:id", unitController.deleteUnit);
router.get("/getAll/paginated", unitController.getAllUnitsPaginated);

module.exports = router;
