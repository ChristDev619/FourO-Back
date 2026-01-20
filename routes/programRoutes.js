const express = require("express");
const router = express.Router();
const programController = require("../controllers/program.controller");

// Create a new program
router.post("/", programController.createProgram);

// Retrieve all programs
router.get("/", programController.getAllPrograms);

// Retrieve a single program by ID
router.get("/:id", programController.getProgramById);

// Update a program by ID
router.patch("/:id", programController.updateProgram);

// Delete a program by ID
router.delete("/:id", programController.deleteProgram);

// Search programs by name
router.get("/search/name/:name", programController.getProgramByName);

// Retrieve all programs paginated
router.get("/getAll/paginated", programController.getAllProgramsPaginated);

router.post("/upload/bulk-insert", programController.bulkInsertPrograms);

router.patch("/:id/confirm-merge", programController.confirmMergeProgram);

module.exports = router;
