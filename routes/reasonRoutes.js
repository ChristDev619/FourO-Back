const express = require("express");
const router = express.Router();
const reasonController = require("../controllers/reason.controller");

// Create a new reason
router.post("/", reasonController.createReason);

// Retrieve all reasons
router.get("/", reasonController.getAllReasons);

// Retrieve a single reason by ID
router.get("/:id", reasonController.getReasonById);

// Update a reason by ID
router.patch("/:id", reasonController.updateReason);

// Delete a reason by ID
router.delete("/:id", reasonController.deleteReason);

// Search reasons by name
router.get("/search/name/:name", reasonController.getReasonByName);

// Retrieve all reasons paginated
router.get("/getAll/paginated", reasonController.getAllReasonsPaginated);
router.post("/upload/bulk-insert", reasonController.bulkInsertReasons);

module.exports = router;
