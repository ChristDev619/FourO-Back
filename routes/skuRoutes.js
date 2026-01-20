const express = require("express");
const router = express.Router();
const skuController = require("../controllers/sku.controller");

// Create a new SKU
router.post("/", skuController.createSku);

// Retrieve all SKUs
router.get("/", skuController.getAllSkus);

// Retrieve a single SKU by ID
router.get("/:id", skuController.getSkuById);

// Update a SKU by ID
router.patch("/:id", skuController.updateSku);

// Delete a SKU by ID
router.delete("/:id", skuController.deleteSku);

// Search SKUs by name
router.get("/search/name/:name", skuController.getSkuByName);

// Retrieve all SKUs paginated
router.get("/getAll/paginated", skuController.getAllSkusPaginated);

module.exports = router;
