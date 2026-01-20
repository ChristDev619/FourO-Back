const express = require("express");
const router = express.Router();
const packageTypeController = require("../controllers/packageType.controller");

// Create a new package type
router.post("/", packageTypeController.createPackageType);

// Retrieve all package types
router.get("/", packageTypeController.getAllPackageTypes);

// Retrieve active package types only
router.get("/active", packageTypeController.getActivePackageTypes);

// Retrieve a single package type by ID
router.get("/:id", packageTypeController.getPackageTypeById);

// Update a package type by ID
router.patch("/:id", packageTypeController.updatePackageType);

// Delete a package type by ID
router.delete("/:id", packageTypeController.deletePackageType);

// Retrieve all package types paginated
router.get("/getAll/paginated", packageTypeController.getAllPackageTypesPaginated);

module.exports = router;

