const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'warn', // Changed from 'info' to 'warn' to reduce verbosity
  format: logFormat,
  transports: [
    // Console logging
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    
    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // Combined log file (all levels)
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // Queue-specific log file (only warnings and errors by default)
    new winston.transports.File({
      filename: path.join(logsDir, 'queue.log'),
      level: 'warn', // Changed from 'info' to 'warn' to reduce verbosity
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ],
});

// Add queue-specific logging methods
logger.queue = {
  jobStarted: (jobId, data) => {
    // Only log job starts if LOG_LEVEL is 'info' or lower
    if (process.env.LOG_LEVEL === 'info' || process.env.LOG_LEVEL === 'debug') {
      logger.info('Queue job started', { 
        type: 'queue_job_started',
        jobId, 
        data,
        timestamp: new Date().toISOString()
      });
    }
  },
  
  jobCompleted: (jobId, duration) => {
    // Only log successful completions if LOG_LEVEL is 'info' or lower
    if (process.env.LOG_LEVEL === 'info' || process.env.LOG_LEVEL === 'debug') {
      logger.info('Queue job completed', { 
        type: 'queue_job_completed',
        jobId, 
        duration,
        timestamp: new Date().toISOString()
      });
    }
  },
  
  jobFailed: (jobId, error, data) => {
    // Always log failures (error level)
    logger.error('Queue job failed', { 
      type: 'queue_job_failed',
      jobId, 
      error: error.message,
      stack: error.stack,
      data,
      timestamp: new Date().toISOString()
    });
  },
  
  jobStalled: (jobId, data) => {
    // Always log stalls (warning level)
    logger.warn('Queue job stalled', { 
      type: 'queue_job_stalled',
      jobId, 
      data,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = logger; 