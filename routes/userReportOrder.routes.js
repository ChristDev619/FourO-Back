const express = require("express");
const router = express.Router();
const userReportOrderController = require("../controllers/userReportOrder.controller");

router.post("/user-report-orders", userReportOrderController.updateUserReportOrders);

module.exports = router;