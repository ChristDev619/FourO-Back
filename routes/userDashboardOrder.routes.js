const express = require("express");
const router = express.Router();
const userDashboardOrderController = require("../controllers/userDashboardOrder.controller");

// Update user dashboard orders (bulk replace)
router.post("/user-dashboard-orders", userDashboardOrderController.updateUserDashboardOrders);

module.exports = router;
