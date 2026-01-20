// utils/queues/recalculationQueue.js
const Queue = require('bull');
const IORedis = require('ioredis');
const { bullRedisConfig } = require('../redisConfig');

// Normalize a robust option set for *all* Bull clients (client/subscriber/blocking)
function makeRedisOptions(overrides = {}) {
  return {
    // Base from central config
    ...bullRedisConfig,

    // Connect immediately, avoid writes during "still connecting"
    lazyConnect: false,

    // Critical flags for Bull reliability
    // (Bull often uses a client with offlineQueue=false; we force true to avoid "Stream isn't writeable..." crashes)
    enableOfflineQueue: true,
    autoResendUnfulfilledCommands: true,

    // Recommended with Bull: don't fail commands if a reconnection occurs mid-flight
    // (Bull handles its own retries/timeouts)
    maxRetriesPerRequest: null,

    // Reasonable retry strategy
    retryStrategy(times) {
      // backoff up to ~5s
      return Math.min(500 + times * 250, 5000);
    },

    // Reconnect on MOVED/ASK or read-only errors during failover
    reconnectOnError(err) {
      const msg = err && err.message ? err.message : '';
      if (
        msg.includes('READONLY') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('EPIPE') ||
        msg.includes('ECONNRESET') ||
        /Connection is closed/i.test(msg)
      ) {
        return true;
      }
      return false;
    },

    // Allow caller overrides
    ...overrides,
  };
}

const recalculationQueue = new Queue('recalculation', {
    redis: makeRedisOptions(), // Use robust Redis options
    defaultJobOptions: {
        removeOnComplete: parseInt(process.env.BULL_REMOVE_ON_COMPLETE || '100', 10),
        removeOnFail: parseInt(process.env.BULL_REMOVE_ON_FAIL || '50', 10),
        attempts: parseInt(process.env.BULL_ATTEMPTS || '5', 10),
        backoff: {
            type: process.env.BULL_BACKOFF_TYPE || 'exponential',
            delay: parseInt(process.env.BULL_BACKOFF_DELAY_MS || '3000', 10)
        },
        // Add timeout to prevent jobs from hanging indefinitely
        timeout: parseInt(process.env.BULL_TIMEOUT_MS || '3600000', 10),
        // Add job completion handling
        jobId: undefined, // Let Bull generate job IDs
    },
    // Add queue-level settings for better resilience
    settings: {
        stalledInterval: parseInt(process.env.BULL_STALLED_INTERVAL_MS || '60000', 10),
        maxStalledCount: parseInt(process.env.BULL_MAX_STALLED_COUNT || '2', 10),
        lockDuration: parseInt(process.env.BULL_LOCK_DURATION_MS || '3600000', 10),
        lockRenewTime: parseInt(process.env.BULL_LOCK_RENEW_TIME_MS || '1800000', 10),
    }
});

module.exports = recalculationQueue;
