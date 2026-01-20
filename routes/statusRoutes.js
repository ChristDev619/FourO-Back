const express = require("express");
const router = express.Router();
const statusController = require("../controllers/statusController");

router.post("/", statusController.createStatus);
router.get("/", statusController.getAllStatuses);
router.get("/getAll/paginated", statusController.getAllStatusesPaginated);
router.get("/:id", statusController.getStatusById);
router.patch("/:id", statusController.updateStatus);
router.delete("/:id", statusController.deleteStatus);
router.post("/upload/bulk-insert", statusController.bulkInsertStatuses);

module.exports = router;
