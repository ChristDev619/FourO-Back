const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Enhanced log format with correlation ID
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, correlationId, userId, sessionId, requestId, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      correlationId,
      userId,
      sessionId,
      requestId,
      service: 'fouro-backend',
      environment: process.env.NODE_ENV || 'development',
      ...meta
    });
  })
);

// Create enhanced logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Console logging with correlation ID
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, correlationId, userId, ...meta }) => {
          const corrId = correlationId ? `[${correlationId}]` : '[NO-CORR-ID]';
          const user = userId ? `[User:${userId}]` : '';
          return `${timestamp} ${level}: ${corrId}${user} ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
      )
    }),
    
    // Error log file with correlation tracking
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
    
    // Combined log file with correlation tracking
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
    
    // Correlation-specific log file for request tracking
    new winston.transports.File({
      filename: path.join(logsDir, 'correlation.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    })
  ],
});

// Enhanced logger with correlation ID support
class CorrelationLogger {
  constructor() {
    this.logger = logger;
  }

  // Create a child logger with correlation context
  child(correlationId, userId = null, sessionId = null, requestId = null) {
    return {
      info: (message, meta = {}) => this.logger.info(message, {
        correlationId,
        userId,
        sessionId,
        requestId,
        ...meta
      }),
      
      warn: (message, meta = {}) => this.logger.warn(message, {
        correlationId,
        userId,
        sessionId,
        requestId,
        ...meta
      }),
      
      error: (message, meta = {}) => this.logger.error(message, {
        correlationId,
        userId,
        sessionId,
        requestId,
        ...meta
      }),
      
      debug: (message, meta = {}) => this.logger.debug(message, {
        correlationId,
        userId,
        sessionId,
        requestId,
        ...meta
      }),

      // Request lifecycle logging
      requestStart: (req, meta = {}) => this.logger.info('Request started', {
        correlationId,
        userId,
        sessionId,
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        ...meta
      }),

      requestEnd: (req, res, duration, meta = {}) => this.logger.info('Request completed', {
        correlationId,
        userId,
        sessionId,
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        ...meta
      }),

      // Database operation logging
      dbQuery: (query, duration, meta = {}) => this.logger.debug('Database query', {
        correlationId,
        userId,
        sessionId,
        requestId,
        query: query.substring(0, 200), // Truncate long queries
        duration,
        ...meta
      }),

      // Queue operation logging
      queueJob: (jobId, status, data = {}, meta = {}) => this.logger.info(`Queue job ${status}`, {
        correlationId,
        userId,
        sessionId,
        requestId,
        jobId,
        status,
        data,
        ...meta
      }),

      // Business logic logging
      businessEvent: (event, data = {}, meta = {}) => this.logger.info(`Business event: ${event}`, {
        correlationId,
        userId,
        sessionId,
        requestId,
        event,
        data,
        ...meta
      }),

      // Error with context
      errorWithContext: (error, context = {}, meta = {}) => this.logger.error('Error occurred', {
        correlationId,
        userId,
        sessionId,
        requestId,
        error: error.message,
        stack: error.stack,
        context,
        ...meta
      })
    };
  }

  // Generate new correlation ID
  generateCorrelationId() {
    return uuidv4();
  }

  // Extract correlation ID from request headers
  extractCorrelationId(req) {
    return req.headers['x-correlation-id'] || 
           req.headers['x-request-id'] || 
           this.generateCorrelationId();
  }

  // Global logging methods (without correlation context)
  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }
}

// Create singleton instance
const correlationLogger = new CorrelationLogger();

module.exports = correlationLogger;
