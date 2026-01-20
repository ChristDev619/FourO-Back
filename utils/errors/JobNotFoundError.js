const BaseError = require('./BaseError');

/**
 * Job Not Found Error
 * 
 * Thrown when a requested job cannot be found in the system.
 * This error indicates a critical issue where the job entity
 * expected to exist does not, and should trigger appropriate
 * error handling (e.g., retry logic, DLQ, etc.).
 * 
 * @class JobNotFoundError
 * @extends BaseError
 */
class JobNotFoundError extends BaseError {
  /**
   * Creates an instance of JobNotFoundError
   * 
   * @param {string|number} jobId - The job ID that was not found
   * @param {Object} [metadata={}] - Additional error metadata
   * @param {Error} [cause] - Original error that caused this error
   */
  constructor(jobId, metadata = {}, cause = null) {
    const message = `Job not found: ${jobId}`;
    const errorMetadata = {
      jobId,
      ...metadata
    };
    
    super(message, errorMetadata, 'JOB_NOT_FOUND', cause);
    
    // Ensure jobId is always available for easy access
    this.jobId = jobId;
  }

  /**
   * Static factory method for creating JobNotFoundError
   * Provides alternative way to create error instances
   * 
   * @param {string|number} jobId - The job ID that was not found
   * @param {Object} [metadata={}] - Additional error metadata
   * @returns {JobNotFoundError} New JobNotFoundError instance
   */
  static create(jobId, metadata = {}) {
    return new JobNotFoundError(jobId, metadata);
  }
}

module.exports = JobNotFoundError;

