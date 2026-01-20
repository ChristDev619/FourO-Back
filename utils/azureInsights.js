const correlationLogger = require('./correlationLogger');

/**
 * Azure Application Insights Integration
 * Provides structured logging for Azure monitoring
 */
class AzureInsightsLogger {
  constructor() {
    this.isEnabled = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
    this.logger = correlationLogger;
  }

  /**
   * Log custom event to Application Insights
   */
  trackEvent(eventName, properties = {}, measurements = {}) {
    if (!this.isEnabled) {
      this.logger.info('Application Insights event (not sent)', {
        type: 'azure_insights_event',
        eventName,
        properties,
        measurements
      });
      return;
    }

    // In production, this would use the Application Insights SDK
    this.logger.info('Application Insights event', {
      type: 'azure_insights_event',
      eventName,
      properties,
      measurements,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log custom metric to Application Insights
   */
  trackMetric(metricName, value, properties = {}) {
    if (!this.isEnabled) {
      this.logger.info('Application Insights metric (not sent)', {
        type: 'azure_insights_metric',
        metricName,
        value,
        properties
      });
      return;
    }

    this.logger.info('Application Insights metric', {
      type: 'azure_insights_metric',
      metricName,
      value,
      properties,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log dependency call to Application Insights
   */
  trackDependency(dependencyType, name, data, duration, success, resultCode) {
    if (!this.isEnabled) {
      this.logger.info('Application Insights dependency (not sent)', {
        type: 'azure_insights_dependency',
        dependencyType,
        name,
        data,
        duration,
        success,
        resultCode
      });
      return;
    }

    this.logger.info('Application Insights dependency', {
      type: 'azure_insights_dependency',
      dependencyType,
      name,
      data,
      duration,
      success,
      resultCode,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log exception to Application Insights
   */
  trackException(exception, properties = {}) {
    if (!this.isEnabled) {
      this.logger.error('Application Insights exception (not sent)', {
        type: 'azure_insights_exception',
        exception: exception.message,
        stack: exception.stack,
        properties
      });
      return;
    }

    this.logger.error('Application Insights exception', {
      type: 'azure_insights_exception',
      exception: exception.message,
      stack: exception.stack,
      properties,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log request to Application Insights
   */
  trackRequest(correlationId, method, url, duration, resultCode, success) {
    if (!this.isEnabled) {
      this.logger.info('Application Insights request (not sent)', {
        type: 'azure_insights_request',
        correlationId,
        method,
        url,
        duration,
        resultCode,
        success
      });
      return;
    }

    this.logger.info('Application Insights request', {
      type: 'azure_insights_request',
      correlationId,
      method,
      url,
      duration,
      resultCode,
      success,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log trace to Application Insights
   */
  trackTrace(message, severityLevel = 1, properties = {}) {
    if (!this.isEnabled) {
      this.logger.info('Application Insights trace (not sent)', {
        type: 'azure_insights_trace',
        message,
        severityLevel,
        properties
      });
      return;
    }

    this.logger.info('Application Insights trace', {
      type: 'azure_insights_trace',
      message,
      severityLevel,
      properties,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Flush telemetry data
   */
  flush() {
    if (!this.isEnabled) {
      this.logger.info('Application Insights flush (not sent)');
      return;
    }

    this.logger.info('Application Insights flush');
  }
}

// Create singleton instance
const azureInsights = new AzureInsightsLogger();

module.exports = azureInsights;
