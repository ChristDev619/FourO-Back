require('dotenv').config();
const express = require("express");
const app = express();

const cors = require("cors");
const port = 8011;
// Trust proxy for Azure Front Door
app.set("trust proxy", 1);

// Import correlation middleware
const { correlationMiddleware, errorCorrelationMiddleware } = require('./middlewares/correlationMiddleware');

app.use(
  cors({
    origin: [
      process.env.FRONTEND_ORIGIN,
      "https://aquafina-frontend.azurewebsites.net",
      "https://rim-frontend1.azurewebsites.net",
      "https://fouro-frontend1-a8evhqa8cngpg5a5.uaenorth-01.azurewebsites.net",
      "https://fouro-api-fggchubgdqf5c2bj.z03.azurefd.net",
      "https://rim-api-endpoint-hncgb6dwc8hrckfx.z03.azurefd.net"
    ],
    credentials: true, // Allow cookies and Authorization headers
    allowedHeaders: [
      "Content-Type", 
      "Authorization", 
      "X-Requested-With",
      "X-Correlation-ID",
      "X-Session-ID", 
      "X-User-ID",
      "X-Request-ID"
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);
const { sequelize } = require("./dbInit");

// create tables if not exists
// sequelize.sync({ alter: true })

// Configure body parser with increased limits for large file uploads
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Apply correlation middleware to all routes
app.use(correlationMiddleware);

// Set request timeout for large file operations (10 minutes)
app.use('/api/tag-values/preview-missing', (req, res, next) => {
  req.setTimeout(10 * 60 * 1000, () => {
    console.error('❌ Request timeout for preview-missing operation');
    if (!res.headersSent) {
      res.status(408).json({ 
        error: 'Request timeout - file too large or processing took too long',
        suggestion: 'Try splitting the file into smaller chunks or process data in smaller batches'
      });
    }
  });
  next();
});

// Set request timeout for upload operations (10 minutes)
app.use('/api/tag-values/upload-tag-values', (req, res, next) => {
  req.setTimeout(10 * 60 * 1000, () => {
    console.error('❌ Request timeout for upload-tag-values operation');
    if (!res.headersSent) {
      res.status(408).json({ 
        error: 'Request timeout - file too large or processing took too long',
        suggestion: 'Try splitting the file into smaller chunks'
      });
    }
  });
  next();
});
const machineRoutes = require("./routes/machineRoutes");
const generatorRoutes = require("./routes/generatorRoutes");
const locationRoutes = require("./routes/locationRoutes");
const metersRoutes = require("./routes/metersRoutes");
const accessListRoutes = require("./routes/accessListRoutes");
const levelRoutes = require("./routes/levelRoutes");
const profileRoutes = require("./routes/profileRoutes");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/auth.routes");
const tagsRoutes = require("./routes/tags.routes");
const tagValuesRoutes = require("./routes/tagValues.routes");
const tagMappingRoutes = require("./routes/tagMapping.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const cardRoutes = require("./routes/card.routes");
const tariffRoutes = require("./routes/tariffRoutes.routes");
const tariffTypesRoutes = require("./routes/tariffTypes.Routes.js");
const settingsRoutes = require("./routes/settings.routes");

const tariffUsageRoutes = require("./routes/tariffUsage.routes");
const unitRoutes = require("./routes/unitRoutes");
const generatorMachineMeterTagValuesRoutes = require("./routes/generatorMachineMeterTagValues.routes");

const Alarm = require("./routes/alarmRoutes");
const Job = require("./routes/jobRoutes");
const Line = require("./routes/lineRoutes");
const PlannedDowntime = require("./routes/plannedDowntimeRoutes");
const Program = require("./routes/programRoutes");
const Reason = require("./routes/reasonRoutes");
const Recipie = require("./routes/recipieRoutes");
const PackageType = require("./routes/packageTypeRoutes");
const Sku = require("./routes/skuRoutes");
const Status = require("./routes/statusRoutes.js");
const DesignSpeed = require("./routes/designSpeed.routes");
const jobLineMachineTagRoutes = require("./routes/joblinemachinetag.routes.js");
const lineMachineRoutes = require("./routes/lineMachine.routes");
const alarmAggregationsRoutes = require("./routes/alarmAggregationRoutes.js");
const reportRoutes = require("./routes/report.routes");
const userDashboardOrderRoutes = require("./routes/userDashboardOrder.routes");
const userReportOrderRoutes = require("./routes/userReportOrder.routes");
const productionRunRoutes = require("./routes/productionRun.routes");
const bulkTagOperationsRoutes = require("./routes/bulkTagOperations.routes");
const jobStatusRoutes = require("./routes/jobStatus.routes");
const notificationEventRoutes = require("./routes/notificationEvent.routes");
const notificationRoutes = require("./routes/notification.routes");
const publicNotificationRoutes = require("./routes/publicNotification.routes");
const demandForecastRoutes = require("./routes/demandForecastRoutes");
const seasonalityDataRoutes = require("./routes/seasonalityDataRoutes");
const monthlyForecastRoutes = require("./routes/monthlyForecastRoutes");
const lineDataRoutes = require("./routes/lineDataRoutes");
const packageSummaryRoutes = require("./routes/packageSummaryRoutes");
const planningDashboardRoutes = require("./routes/planningDashboard.routes");
const duplicateJobMonitorRoutes = require("./routes/duplicateJobMonitor.routes");
const dataGapInspectorRoutes = require("./routes/dataGapInspector.routes");
app.use("/api/machines", machineRoutes);
app.use("/api/generators", generatorRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/meters", metersRoutes);
app.use("/api/access-lists", accessListRoutes);
app.use("/api/levels", levelRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/tags", tagsRoutes);
app.use("/api/tag-values", tagValuesRoutes);
app.use("/api/tag-mapping", tagMappingRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/cards", cardRoutes);
app.use("/api/tariffs", tariffRoutes);
app.use("/api/tariff-Types", tariffTypesRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/tariffUsages", tariffUsageRoutes);
app.use("/api/units", unitRoutes);
app.use(
  "/api/generator-machine-meter-tag-values",
  generatorMachineMeterTagValuesRoutes
);
app.use("/api/alarms", Alarm);
app.use("/api/jobs", Job);
app.use("/api/lines", Line);
app.use("/api/plannedDowntimes", PlannedDowntime);
app.use("/api/programs", Program);
app.use("/api/reasons", Reason);
app.use("/api/recipes", Recipie);
app.use("/api/package-types", PackageType);
app.use("/api/skus", Sku);
app.use("/api/statuses", Status);
app.use("/api/designSpeeds", DesignSpeed);
app.use("/api/jlmt", jobLineMachineTagRoutes);
app.use("/api/line-machines", lineMachineRoutes);
app.use("/api/alarmAggregations", alarmAggregationsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api", userDashboardOrderRoutes);
app.use("/api", userReportOrderRoutes);
app.use("/api/productionrun", productionRunRoutes);
app.use("/api/bulk-tag-operations", bulkTagOperationsRoutes);
app.use("/api/job-status", jobStatusRoutes);
app.use("/api/notification-events", notificationEventRoutes);
app.use("/api/notifications", publicNotificationRoutes); // Public routes (no auth) - must be before protected routes
app.use("/api/notifications", notificationRoutes);
app.use("/api/demand-forecasts", demandForecastRoutes);
app.use("/api/seasonality-data", seasonalityDataRoutes);
app.use("/api/monthly-forecasts", monthlyForecastRoutes);
app.use("/api/line-data", lineDataRoutes);
app.use("/api/package-summaries", packageSummaryRoutes);
app.use("/api/planning-dashboard", planningDashboardRoutes);
app.use("/api/duplicate-job-monitor", duplicateJobMonitorRoutes);
app.use("/api/data-gap-inspector", dataGapInspectorRoutes);

// Logs routes
const logsRoutes = require("./routes/logs.routes");
app.use("/api/logs", logsRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development"
    });
});

const httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
// Start feed inactivity monitor (1-minute checker)
try {
  const { getFeedInactivityMonitor } = require('./utils/services/FeedInactivityMonitor');
  getFeedInactivityMonitor().startChecker();
  console.log('✅ Feed inactivity monitor started');
} catch (e) {
  console.error('⚠️  Failed to start feed inactivity monitor:', e.message);
}
const { setupWebSocket, jobSubscriptions } = require("./websocketServer");
const { setGlobalJobNotificationService } = require("./utils/services/GlobalJobNotificationService");

// Setup WebSocket server
setupWebSocket(httpServer);

// Initialize global job notification service
setGlobalJobNotificationService(jobSubscriptions);

// Setup Redis subscriber for job completion notifications from worker
const { getSharedSubscriber } = require('./utils/redisConfig');

// Connect and subscribe to job completion notifications (non-blocking for development)
(async () => {
  try {
    console.log('Attempting to connect to Redis subscriber...');
    const subscriber = await getSharedSubscriber();
    console.log('✅ Redis subscriber connected successfully');
    
    await subscriber.subscribe('job-completion', (message) => {
      try {
        const jobData = JSON.parse(message);
        const jobId = jobData.jobId;
        console.log('Received job completion notification from Redis:', jobData);
        // Forward to WebSocket clients
        const subscriptions = jobSubscriptions.get(jobId);
        console.log(`Subscriptions for jobId: ${jobId}`, subscriptions);
        if (subscriptions && subscriptions.size > 0) {
          let successCount = 0;
          let failureCount = 0;

          subscriptions.forEach((sub, subId) => {
            try {
              console.log(`WebSocket readyState for userId ${sub.userId} (subId: ${subId}): ${sub.ws.readyState}`);
              if (sub.ws.readyState === 1) { // WebSocket.OPEN
                const messageStr = JSON.stringify(jobData);
                sub.ws.send(messageStr);
                successCount++;
                console.log(`✓ Forwarded job completion notification to userId: ${sub.userId} for jobId: ${jobId}`);
              } else {
                failureCount++;
                console.log(`✗ WebSocket not open for userId: ${sub.userId} (state: ${sub.ws.readyState})`);
              }
            } catch (error) {
              failureCount++;
              console.error(`Error forwarding job completion notification to userId: ${sub.userId}`, error.message);
              console.error('Error details:', error);
            }
          });

          console.log(`Job completion forwarding summary - Success: ${successCount}, Failed: ${failureCount}`);
        } else {
          console.log(`No WebSocket subscriptions found for jobId: ${jobId}`);
        }
      } catch (error) {
        console.error('Error processing job completion message from Redis:', error);
      }
    });
    console.log('✅ Subscribed to job-completion Redis channel');
  } catch (err) {
    console.error('⚠️  Redis subscriber connection failed - job notifications will be limited:', err.message);
    console.log('💡 Check Redis configuration and connection for full job notification functionality');
    // Don't crash the server, continue without Redis
  }
})();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'fouro-backend',
    version: '1.0.0'
  });
});

// Global error handling middleware (must be last)
app.use(errorCorrelationMiddleware);
