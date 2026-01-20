const { WebSocket } = require("ws");
const { getSharedPublisher, resetSharedPublisher } = require('../redisConfig');

class JobNotificationService {
  constructor(jobSubscriptions) {
    this.jobSubscriptions = jobSubscriptions;
  }

  async _ensurePublisher() {
    try {
      return await getSharedPublisher();
    } catch (err) {
      console.error('Error acquiring Redis publisher:', err && err.message ? err.message : err);
      throw err;
    }
  }

  async _publishWithRetry(channel, message) {
    const maxRetries = parseInt(process.env.JOB_NOTIFY_RETRIES || '8', 10);
    const delayMs = parseInt(process.env.JOB_NOTIFY_RETRY_DELAY_MS || '1000', 10);

    let attempt = 0;
    /* eslint-disable no-constant-condition */
    while (true) {
      try {
        const pub = await this._ensurePublisher();
        await pub.publish(channel, message);
        return; // success
      } catch (err) {
        const msg = err && err.message ? err.message : '';
        const transient = /ECONNRESET|ETIMEDOUT|EPIPE|Connection is closed|socket closed/i.test(msg);
        attempt++;
        if (!transient || attempt > maxRetries) {
          console.error(`Publish failed after ${attempt} attempt(s):`, msg);
          throw err;
        }
        // Force recreate the publisher after a connection error
        try { await resetSharedPublisher(); } catch (_) {}
        await new Promise(r => setTimeout(r, delayMs * attempt));
      }
    }
  }

  /**
   * Notify subscribers about job completion
   * @param {number} jobId - The job ID that was completed
   * @param {'success'|'error'} status
   * @param {string} message
   * @param {object} additionalData
   */
  async notifyJobCompletion(jobId, status, message, additionalData = {}) {
    const formattedJobId = `job-${jobId}`; // Format job ID for consistency
    const payload = {
      type: 'jobCompletion',
      jobId: formattedJobId, // keep current format
      status,
      message,
      ...additionalData
    };

    // Add error field only for error status
    if (status === 'error' && additionalData.error) {
      payload.error = additionalData.error;
    }

    // Publish to Redis for cross-process communication
    try {
      await this._publishWithRetry('job-completion', JSON.stringify(payload));
      console.log(`✓ Published job completion notification to Redis for jobId: ${formattedJobId}`);
    } catch (err) {
      console.error('Error publishing job completion to Redis:', err && err.message ? err.message : err);
    }

    // Also try direct WebSocket notification (single-process / same node)
    // Use formatted job ID for subscription lookup to match frontend subscription
    const subscriptions = this.jobSubscriptions.get(formattedJobId);
    if (subscriptions && subscriptions.size > 0) {
      let successCount = 0;
      let failureCount = 0;

                subscriptions.forEach((sub) => {
            try {
              if (sub.ws.readyState === WebSocket.OPEN) {
                const msg = JSON.stringify(payload);
                sub.ws.send(msg);
                successCount++;
                console.log(`✓ Sent direct job completion notification to userId: ${sub.userId} for jobId: ${formattedJobId}`);
              } else {
                failureCount++;
                console.log(`✗ WebSocket not open for userId: ${sub.userId} (state: ${sub.ws.readyState})`);
              }
            } catch (error) {
              failureCount++;
              console.error(`Error sending job completion notification to userId: ${sub.userId}`, error.message);
            }
          });

          console.log(`Direct job completion notification summary - Success: ${successCount}, Failed: ${failureCount}`);
        } else {
          console.log(`No direct job completion subscriptions found for jobId: ${formattedJobId}`);
        }
  }

  /**
   * Notify job completion success
   */
  async notifyJobSuccess(jobId, message = 'Recalculation completed successfully') {
    return await this.notifyJobCompletion(jobId, 'success', message);
  }

  /**
   * Notify job completion error
   */
  async notifyJobError(jobId, errorMessage, error = null) {
    return await this.notifyJobCompletion(jobId, 'error', errorMessage, {
      error: error ? error.message : null
    });
  }

  /**
   * Clean up closed WebSocket connections for job subscriptions
   */
  cleanupClosedConnections() {
    let cleanedCount = 0;

    this.jobSubscriptions.forEach((subscriptions, jobId) => {
      const activeSubscriptions = new Map();

      subscriptions.forEach((sub, subId) => {
        if (sub.ws.readyState === WebSocket.OPEN) {
          activeSubscriptions.set(subId, sub);
        } else {
          cleanedCount++;
        }
      });

      if (activeSubscriptions.size === 0) {
        this.jobSubscriptions.delete(jobId);
      } else {
        this.jobSubscriptions.set(jobId, activeSubscriptions);
      }
    });

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} closed WebSocket connections for job subscriptions`);
    }

    return cleanedCount;
  }
}

module.exports = JobNotificationService;
