const express = require("express");
const router = express.Router();
const cardController = require("../controllers/card.controller");

// Create a new card
router.post("/", cardController.createCard);

// Retrieve all cards
router.get("/", cardController.getAllCards);

// Retrieve a single card by id
router.get("/:id", cardController.getCardById);

// Update a card by id
// router.put("/:id", cardController.updateCard);

// Delete a card by id
router.delete("/:id", cardController.deleteCard);

router.get("/dashboard/:dashboardId", cardController.getCardsByDashboardId);
router.get("/:id/execute", cardController.executeQuery);
router.put("/:id/updateDates", cardController.updateQueryDates);
router.post("/execute-tariff-config", cardController.executeTariffConfig);
router.get("/:id/execute/gauge", cardController.executeGaugeQuery);

router.get("/:id/execute/barchart", cardController.executeBarchartQuery);
router.get(
  "/:id/execute/stackedchart",
  cardController.executeStackedBarChartQuery
);

router.get(
  "/:id/execute/barchartStats",
  cardController.executeStatisticalBarchartQuery
);

router.get("/:id/execute/barchartKpis", cardController.executeBarChartKpis);

router.get("/:id/execute/linechart", cardController.executeLineChartQuery);
router.get("/:id/execute/sunburst", cardController.executeSunBurstChartQuery);
router.get("/:id/execute/trend", cardController.executeTrend);

router.get(
  "/:id/execute/barchart/drilldown",
  cardController.executeBarchartDrillDownQuery
); // New route

router.get(
  "/:id/execute/heatmapchart",
  cardController.executeHeatMapChartQuery
);
router.get("/:id/execute/sankeychart", cardController.executeSankeyChartQuery);

router.get("/:id/execute/datagrid", cardController.executeDataGridQuery);
router.get("/:id/execute/ganttchart", cardController.executeGanttChartQuery);
router.get("/:id/execute/ganttchart/live", cardController.executeLiveGanttChartQuery);
router.get("/:id/execute/waterfallchart", cardController.executeWaterfallChartQuery);
 router.get("/:id/execute/horizontalbarchart-v2", cardController.executeHorizontalBarChartQueryV2);
router.get("/:id/execute/oeeTimeSeries", cardController.executeOEETimeSeriesQuery);
router.put("/cards/:id", cardController.updateCard);

module.exports = router;
