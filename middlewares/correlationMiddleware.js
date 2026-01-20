const correlationLogger = require('../utils/correlationLogger');

/**
 * Correlation ID Middleware
 * Generates or extracts correlation ID for request tracking
 */
const correlationMiddleware = (req, res, next) => {
  // Extract or generate correlation ID
  const correlationId = correlationLogger.extractCorrelationId(req);
  
  // Extract user context from JWT token if available
  let userId = null;
  let sessionId = null;
  
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      // Decode JWT to extract user info (without verification for logging purposes)
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      userId = payload.userId || payload.id;
      sessionId = payload.sessionId || payload.jti;
    }
  } catch (error) {
    // Ignore token parsing errors for logging
  }

  // Generate request ID for this specific request
  const requestId = correlationLogger.generateCorrelationId();

  // Add correlation context to request
  req.correlationId = correlationId;
  req.userId = userId;
  req.sessionId = sessionId;
  req.requestId = requestId;

  // Create child logger with correlation context
  req.logger = correlationLogger.child(correlationId, userId, sessionId, requestId);

  // Add correlation ID to response headers
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('X-Request-ID', requestId);

  // Log request start
  req.logger.requestStart(req, {
    headers: {
      'user-agent': req.get('User-Agent'),
      'content-type': req.get('Content-Type'),
      'content-length': req.get('Content-Length')
    }
  });

  // Track response time
  const startTime = Date.now();
  
  // Override res.end to log request completion
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    
    req.logger.requestEnd(req, res, duration, {
      responseSize: chunk ? chunk.length : 0
    });

    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

/**
 * Error handling middleware with correlation ID
 */
const errorCorrelationMiddleware = (error, req, res, next) => {
  // Ensure we have a logger (fallback if correlation middleware wasn't used)
  if (!req.logger) {
    req.logger = correlationLogger.child(
      req.correlationId || correlationLogger.generateCorrelationId(),
      req.userId,
      req.sessionId,
      req.requestId
    );
  }

  // Log error with full context
  req.logger.errorWithContext(error, {
    method: req.method,
    url: req.url,
    body: req.body,
    query: req.query,
    params: req.params,
    headers: req.headers
  });

  // Send error response with correlation ID
  const statusCode = error.statusCode || error.status || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : error.message;

  res.status(statusCode).json({
    error: message,
    correlationId: req.correlationId,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
  });
};

module.exports = {
  correlationMiddleware,
  errorCorrelationMiddleware
};
