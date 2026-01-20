/**
 * Base Error Class
 * 
 * Provides a foundation for all custom application errors.
 * Follows SOLID principles and best practices for error handling.
 * 
 * @class BaseError
 * @extends Error
 */
class BaseError extends Error {
  /**
   * Creates an instance of BaseError
   * 
   * @param {string} message - Human-readable error message
   * @param {Object} [metadata={}] - Additional error metadata (jobId, context, etc.)
   * @param {string} [code] - Error code for programmatic error handling
   * @param {Error} [cause] - Original error that caused this error (for error chaining)
   */
  constructor(message, metadata = {}, code = null, cause = null) {
    super(message);
    
    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    
    // Set error name to the class name
    this.name = this.constructor.name;
    
    // Error code for programmatic handling
    this.code = code || this.constructor.name.toUpperCase().replace('ERROR', '');
    
    // Additional metadata for context
    this.metadata = metadata;
    
    // Original error that caused this error (for error chaining)
    this.cause = cause;
    
    // Timestamp for error tracking
    this.timestamp = new Date().toISOString();
  }

  /**
   * Convert error to JSON for logging/serialization
   * 
   * @returns {Object} Serialized error object
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      metadata: this.metadata,
      timestamp: this.timestamp,
      stack: this.stack,
      ...(this.cause && { cause: this.cause instanceof Error ? this.cause.message : this.cause })
    };
  }

  /**
   * Check if error is of a specific type
   * 
   * @param {Function} ErrorClass - Error class to check against
   * @returns {boolean} True if error is instance of the specified class
   */
  is(ErrorClass) {
    return this instanceof ErrorClass;
  }
}

module.exports = BaseError;

