const correlationLogger = require('./correlationLogger');

/**
 * Sequelize logging wrapper with correlation ID support
 */
class SequelizeCorrelationLogger {
  constructor() {
    this.logger = correlationLogger;
  }

  /**
   * Log database query with correlation context
   */
  logQuery(sql, timing, options = {}) {
    const correlationId = options.correlationId || 'no-correlation';
    const userId = options.userId || null;
    const sessionId = options.sessionId || null;
    const requestId = options.requestId || null;

    const childLogger = this.logger.child(correlationId, userId, sessionId, requestId);
    
    childLogger.dbQuery(sql, timing, {
      type: 'sequelize_query',
      bind: options.bind,
      transaction: options.transaction ? 'active' : 'none'
    });
  }

  /**
   * Log database transaction events
   */
  logTransaction(event, options = {}) {
    const correlationId = options.correlationId || 'no-correlation';
    const userId = options.userId || null;
    const sessionId = options.sessionId || null;
    const requestId = options.requestId || null;

    const childLogger = this.logger.child(correlationId, userId, sessionId, requestId);
    
    childLogger.info(`Database transaction ${event}`, {
      type: 'sequelize_transaction',
      transactionId: options.transactionId,
      duration: options.duration
    });
  }

  /**
   * Log database connection events
   */
  logConnection(event, options = {}) {
    const correlationId = options.correlationId || 'no-correlation';
    const userId = options.userId || null;
    const sessionId = options.sessionId || null;
    const requestId = options.requestId || null;

    const childLogger = this.logger.child(correlationId, userId, sessionId, requestId);
    
    childLogger.info(`Database connection ${event}`, {
      type: 'sequelize_connection',
      host: options.host,
      database: options.database,
      duration: options.duration
    });
  }

  /**
   * Log database errors
   */
  logError(error, options = {}) {
    const correlationId = options.correlationId || 'no-correlation';
    const userId = options.userId || null;
    const sessionId = options.sessionId || null;
    const requestId = options.requestId || null;

    const childLogger = this.logger.child(correlationId, userId, sessionId, requestId);
    
    childLogger.errorWithContext(error, {
      type: 'sequelize_error',
      sql: options.sql,
      bind: options.bind,
      transaction: options.transaction ? 'active' : 'none'
    });
  }
}

// Create singleton instance
const sequelizeLogger = new SequelizeCorrelationLogger();

module.exports = sequelizeLogger;
