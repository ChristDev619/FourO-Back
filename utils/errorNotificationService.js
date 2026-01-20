const correlationLogger = require('./correlationLogger');
const azureInsights = require('./azureInsights');

/**
 * Error Notification Service
 * Handles error notifications and user alerts
 */
class ErrorNotificationService {
  constructor() {
    this.logger = correlationLogger;
    this.azureInsights = azureInsights;
    this.errorThresholds = {
      critical: 1,      // Immediate notification
      high: 5,          // Notify after 5 errors
      medium: 10,       // Notify after 10 errors
      low: 50           // Notify after 50 errors
    };
    this.errorCounts = new Map(); // Track error counts by type
  }

  /**
   * Process error and determine notification level
   */
  async processError(error, context = {}) {
    const errorType = this.categorizeError(error);
    const severity = this.determineSeverity(error, context);
    
    // Track error count
    this.incrementErrorCount(errorType);
    
    // Log error with correlation context
    const logger = this.logger.child(
      context.correlationId,
      context.userId,
      context.sessionId,
      context.requestId
    );

    logger.errorWithContext(error, {
      type: 'error_notification',
      errorType,
      severity,
      context
    });

    // Track in Azure Application Insights
    this.azureInsights.trackException(error, {
      errorType,
      severity,
      correlationId: context.correlationId,
      userId: context.userId,
      ...context
    });

    // Check if notification should be sent
    if (this.shouldNotify(errorType, severity)) {
      await this.sendNotification(error, errorType, severity, context);
    }

    return {
      errorType,
      severity,
      shouldNotify: this.shouldNotify(errorType, severity)
    };
  }

  /**
   * Categorize error type
   */
  categorizeError(error) {
    if (error.name === 'ValidationError') return 'validation';
    if (error.name === 'AuthenticationError') return 'authentication';
    if (error.name === 'AuthorizationError') return 'authorization';
    if (error.name === 'DatabaseError') return 'database';
    if (error.name === 'NetworkError') return 'network';
    if (error.name === 'TimeoutError') return 'timeout';
    if (error.name === 'RateLimitError') return 'rate_limit';
    if (error.code === 'ECONNREFUSED') return 'connection_refused';
    if (error.code === 'ENOTFOUND') return 'dns_error';
    if (error.statusCode >= 500) return 'server_error';
    if (error.statusCode >= 400) return 'client_error';
    
    return 'unknown';
  }

  /**
   * Determine error severity
   */
  determineSeverity(error, context) {
    // Critical errors
    if (error.name === 'DatabaseError' && error.message.includes('connection')) return 'critical';
    if (error.name === 'AuthenticationError') return 'critical';
    if (error.statusCode >= 500) return 'critical';
    
    // High severity errors
    if (error.name === 'ValidationError' && context.userId) return 'high';
    if (error.name === 'AuthorizationError') return 'high';
    if (error.statusCode === 404 && context.userId) return 'high';
    
    // Medium severity errors
    if (error.name === 'NetworkError') return 'medium';
    if (error.name === 'TimeoutError') return 'medium';
    if (error.statusCode >= 400 && error.statusCode < 500) return 'medium';
    
    // Low severity errors
    return 'low';
  }

  /**
   * Increment error count for tracking
   */
  incrementErrorCount(errorType) {
    const current = this.errorCounts.get(errorType) || 0;
    this.errorCounts.set(errorType, current + 1);
  }

  /**
   * Check if notification should be sent
   */
  shouldNotify(errorType, severity) {
    const count = this.errorCounts.get(errorType) || 0;
    const threshold = this.errorThresholds[severity] || 50;
    
    return count >= threshold;
  }

  /**
   * Send error notification
   */
  async sendNotification(error, errorType, severity, context) {
    const notification = {
      timestamp: new Date().toISOString(),
      errorType,
      severity,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context: {
        correlationId: context.correlationId,
        userId: context.userId,
        sessionId: context.sessionId,
        requestId: context.requestId,
        url: context.url,
        method: context.method,
        userAgent: context.userAgent,
        ip: context.ip
      },
      environment: process.env.NODE_ENV || 'development'
    };

    // Log notification
    this.logger.warn('Error notification sent', {
      type: 'error_notification_sent',
      errorType,
      severity,
      correlationId: context.correlationId
    });

    // Track notification event
    this.azureInsights.trackEvent('ErrorNotification', {
      errorType,
      severity,
      correlationId: context.correlationId,
      userId: context.userId
    });

    // In production, you would send to:
    // - Email notifications
    // - Slack/Discord webhooks
    // - PagerDuty
    // - Azure Service Bus
    // - etc.

    console.log('🚨 ERROR NOTIFICATION:', JSON.stringify(notification, null, 2));
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    return {
      errorCounts: Object.fromEntries(this.errorCounts),
      thresholds: this.errorThresholds,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Reset error counts
   */
  resetErrorCounts() {
    this.errorCounts.clear();
    this.logger.info('Error counts reset');
  }

  /**
   * Update error thresholds
   */
  updateThresholds(newThresholds) {
    this.errorThresholds = { ...this.errorThresholds, ...newThresholds };
    this.logger.info('Error thresholds updated', { thresholds: this.errorThresholds });
  }
}

// Create singleton instance
const errorNotificationService = new ErrorNotificationService();

module.exports = errorNotificationService;
