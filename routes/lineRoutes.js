const express = require("express");
const router = express.Router();
const lineController = require("../controllers/line.controller");

// Create a new Line
router.post("/", lineController.createLine);

// Retrieve all Lines
router.get("/", lineController.getAllLines);

// Retrieve all Lines paginated with machines
router.get("/paginated", lineController.getAllLinesPaginated);

// Retrieve a single Line by ID
router.get("/:id", lineController.getLineById);

// Add a Machine to a Line
router.post("/:lineId/machines", lineController.addMachineToLine);

// Remove a Machine from a Line
router.patch("/:lineId/machines/remove", lineController.removeMachineFromLine);

// Get all machines for a Line
router.get("/:lineId/machines", lineController.getMachinesForLine);

// Update a Line by ID
router.patch("/:id", lineController.updateLine);

router.get("/search/name/:name", lineController.getLineByName);

// Delete a Line by ID
router.delete("/:id", lineController.deleteLine);


router.get("/:lineId/tags", lineController.getLineTags);

router.get("/by-location/:locationId", lineController.getLinesByLocation);

// NEW: Get lines by parent location (plant) for Line Data page
router.get("/by-plant/:plantId", lineController.getLinesByPlant);

module.exports = router;
