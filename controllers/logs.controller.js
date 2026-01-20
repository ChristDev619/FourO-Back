const correlationLogger = require('../utils/correlationLogger');

/**
 * Frontend logs controller
 * Receives and processes frontend logs with correlation ID
 */
exports.receiveFrontendLog = async (req, res) => {
  try {
    const {
      timestamp,
      level,
      message,
      correlationId,
      sessionId,
      userId,
      service,
      environment,
      url,
      userAgent,
      type,
      ...additionalData
    } = req.body;

    // Validate required fields
    if (!timestamp || !level || !message) {
      return res.status(400).json({
        error: 'Missing required fields: timestamp, level, message'
      });
    }

    // Create child logger with correlation context
    const logger = correlationLogger.child(correlationId, userId, sessionId, req.requestId);

    // Log the frontend log entry
    logger.info('Frontend log received', {
      type: 'frontend_log',
      frontendLevel: level,
      frontendMessage: message,
      frontendService: service,
      frontendEnvironment: environment,
      frontendUrl: url,
      frontendUserAgent: userAgent,
      frontendType: type,
      ...additionalData
    });

    // Store in database for analysis (optional)
    // await storeFrontendLog(req.body);

    res.status(200).json({
      message: 'Frontend log received successfully',
      correlationId: req.correlationId
    });

  } catch (error) {
    const logger = correlationLogger.child(req.correlationId, req.userId, req.sessionId, req.requestId);
    logger.errorWithContext(error, {
      type: 'frontend_log_error',
      requestBody: req.body
    });

    res.status(500).json({
      error: 'Failed to process frontend log',
      correlationId: req.correlationId
    });
  }
};

/**
 * Get logs by correlation ID
 */
exports.getLogsByCorrelationId = async (req, res) => {
  try {
    const { correlationId } = req.params;
    const { startDate, endDate, level, limit = 100 } = req.query;

    // This would typically query a log storage system
    // For now, we'll return a placeholder response
    const logs = await queryLogsByCorrelationId(correlationId, {
      startDate,
      endDate,
      level,
      limit: parseInt(limit)
    });

    res.status(200).json({
      correlationId,
      logs,
      count: logs.length
    });

  } catch (error) {
    const logger = correlationLogger.child(req.correlationId, req.userId, req.sessionId, req.requestId);
    logger.errorWithContext(error, {
      type: 'get_logs_error',
      correlationId: req.params.correlationId
    });

    res.status(500).json({
      error: 'Failed to retrieve logs',
      correlationId: req.correlationId
    });
  }
};

/**
 * Get user error summary
 */
exports.getUserErrorSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    // Query errors for specific user
    const errorSummary = await queryUserErrors(userId, {
      startDate,
      endDate
    });

    res.status(200).json({
      userId,
      errorSummary,
      period: { startDate, endDate }
    });

  } catch (error) {
    const logger = correlationLogger.child(req.correlationId, req.userId, req.sessionId, req.requestId);
    logger.errorWithContext(error, {
      type: 'get_user_errors_error',
      userId: req.params.userId
    });

    res.status(500).json({
      error: 'Failed to retrieve user error summary',
      correlationId: req.correlationId
    });
  }
};

/**
 * Placeholder functions for log querying
 * In production, these would integrate with your log storage system
 */
async function queryLogsByCorrelationId(correlationId, options) {
  // This would typically query:
  // - Azure Application Insights
  // - Elasticsearch
  // - CloudWatch
  // - Or your custom log storage
  
  return [
    {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Sample log entry',
      correlationId,
      service: 'fouro-backend'
    }
  ];
}

async function queryUserErrors(userId, options) {
  // Query errors for specific user
  return {
    totalErrors: 0,
    errorsByType: {},
    recentErrors: []
  };
}
