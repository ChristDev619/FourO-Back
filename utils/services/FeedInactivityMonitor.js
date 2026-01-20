const Redis = require('ioredis');
const EmailService = require('./EmailService');
const logger = require('../logger');
const moment = require('moment');

// Static recipients as requested
const RECIPIENTS = [
  'christian_chindy@hotmail.com',
  'joelle@fourosolutions.com',
  'csaikaly@teknologix-automation.com',
  'falam@teknologix-automation.com'
];

// Constants
const ONE_MINUTE_MS = 60 * 1000;
const DEFAULT_THRESHOLD_MIN = 30; // 30 minutes inactivity
const DEFAULT_COOLDOWN_MIN = 120; // 120 minutes between alert emails per feed

// Redis keys
function lastSeenKey(feed) {
  return `bulk:${feed}:lastSeen`;
}
function lastAlertedKey(feed) {
  return `bulk:${feed}:lastAlertedAt`;
}
function alertActiveKey(feed) {
  return `bulk:${feed}:alertActive`;
}

class FeedInactivityMonitor {
  constructor(options = {}) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: 6379,
      password: process.env.REDIS_PASSWORD,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.thresholdMinutes = options.thresholdMinutes || DEFAULT_THRESHOLD_MIN;
    this.cooldownMinutes = options.cooldownMinutes || DEFAULT_COOLDOWN_MIN;
    this.timer = null;
  }

  async connect() {
    if (this.redis.status === 'end' || this.redis.status === 'wait') {
      this.redis.connect().catch(() => {});
    }
  }

  async markLastSeen(feed) {
    try {
      await this.connect();
      const now = Date.now();
      await this.redis.set(lastSeenKey(feed), String(now));
      // If we were in alert, keep alertActive until recovery logic runs in checker
    } catch (err) {
      logger?.error?.(`FeedInactivityMonitor markLastSeen error for ${feed}: ${err.message}`);
    }
  }

  async getFeedState(feed) {
    try {
      await this.connect();
      const [lastSeenStr, lastAlertedStr, alertActiveStr] = await this.redis.mget(
        lastSeenKey(feed),
        lastAlertedKey(feed),
        alertActiveKey(feed)
      );
      return {
        lastSeen: lastSeenStr ? parseInt(lastSeenStr, 10) : null,
        lastAlertedAt: lastAlertedStr ? parseInt(lastAlertedStr, 10) : null,
        alertActive: alertActiveStr === '1',
      };
    } catch (err) {
      logger?.error?.(`[FeedInactivity] Failed to get feed state for ${feed}: ${err.message}`, { error: err });
      throw err;
    }
  }

  async setAlertState(feed, { alertActive, lastAlertedAt = null }) {
    const multi = this.redis.multi();
    multi.set(alertActiveKey(feed), alertActive ? '1' : '0');
    if (lastAlertedAt !== null) {
      multi.set(lastAlertedKey(feed), String(lastAlertedAt));
    }
    await multi.exec();
  }

  async sendEmailAll({ subject, htmlContent, textContent, metadata }) {
    const sendResults = await Promise.allSettled(
      RECIPIENTS.map((to) =>
        EmailService.sendEmail({ to, subject, htmlContent, textContent, metadata })
      )
    );
    return sendResults;
  }

  formatTs(ts) {
    if (!ts) return 'unknown';
    try {
      // Use moment to format in local time (same pattern as notificationEventHandler.js)
      // This avoids UTC timezone issues - converts to local server time
      return moment(ts).format('YYYY-MM-DD HH:mm:ss');
    } catch {
      return String(ts);
    }
  }

  async checkFeed(feed) {
    try {
      const { lastSeen, lastAlertedAt, alertActive } = await this.getFeedState(feed);
      const now = Date.now();
      const thresholdMs = this.thresholdMinutes * ONE_MINUTE_MS;
      const cooldownMs = this.cooldownMinutes * ONE_MINUTE_MS;

      // Unknown lastSeen: do nothing until first full threshold passes from boot
      if (!lastSeen) {
        return;
      }

      const inactiveForMs = now - lastSeen;
      const inactiveForMinutes = Math.floor(inactiveForMs / ONE_MINUTE_MS);

      // Debug logging every check (but only log every 5 minutes to avoid spam)
      if (inactiveForMinutes % 5 === 0 || inactiveForMs >= thresholdMs || alertActive) {
        logger?.debug?.(`[FeedInactivity] Checking ${feed}: inactive for ${inactiveForMinutes}min, alertActive=${alertActive}, lastAlerted=${this.formatTs(lastAlertedAt)}`);
      }

      if (inactiveForMs >= thresholdMs) {
        // Inactive beyond threshold
        const cooldownElapsed = !lastAlertedAt || now - lastAlertedAt >= cooldownMs;
        
        if (!alertActive && cooldownElapsed) {
          logger?.warn?.(`[FeedInactivity] Detected ${inactiveForMinutes}min inactivity for ${feed}, sending alert...`);
          
          const subject = `Bulk feed inactivity: ${feed.toUpperCase()} (≥${this.thresholdMinutes} min)`;
          const html = `
            <p>Detected inactivity for bulk feed <b>${feed.toUpperCase()}</b>.</p>
            <ul>
              <li>Last seen: ${this.formatTs(lastSeen)}</li>
              <li>Inactive for: ${inactiveForMinutes} minutes</li>
              <li>Threshold: ${this.thresholdMinutes} minutes</li>
              <li>Environment: ${process.env.NODE_ENV || 'development'}</li>
              <li>Host: ${process.env.HOSTNAME || require('os').hostname()}</li>
            </ul>
            <p>This likely indicates the upstream system stopped sending data or a network issue.</p>
          `;
          
          try {
            await this.sendEmailAll({ subject, htmlContent: html, metadata: { type: 'feed_inactivity', feed } });
            await this.setAlertState(feed, { alertActive: true, lastAlertedAt: now });
            logger?.warn?.(`[FeedInactivity] ✅ Inactivity alert sent for ${feed}. Last seen: ${this.formatTs(lastSeen)}, inactive for ${inactiveForMinutes}min`);
          } catch (emailErr) {
            logger?.error?.(`[FeedInactivity] ❌ Failed to send inactivity email for ${feed}: ${emailErr.message}`, { error: emailErr });
            throw emailErr;
          }
        } else {
          if (alertActive) {
            logger?.debug?.(`[FeedInactivity] ${feed} already in alert state, skipping (inactive ${inactiveForMinutes}min)`);
          } else if (!cooldownElapsed) {
            const remainingCooldown = Math.ceil((cooldownMs - (now - lastAlertedAt)) / ONE_MINUTE_MS);
            logger?.debug?.(`[FeedInactivity] ${feed} cooldown active, remaining ${remainingCooldown}min (inactive ${inactiveForMinutes}min)`);
          }
        }
        return;
      }

      // Active within threshold and was alerting: send recovery
      if (alertActive) {
        logger?.info?.(`[FeedInactivity] Traffic resumed for ${feed}, sending recovery email...`);
        
        const subject = `Bulk feed recovery: ${feed.toUpperCase()} (traffic resumed)`;
        const html = `
          <p>Traffic has resumed for bulk feed <b>${feed.toUpperCase()}</b>.</p>
          <ul>
            <li>Last seen: ${this.formatTs(lastSeen)}</li>
            <li>Environment: ${process.env.NODE_ENV || 'development'}</li>
            <li>Host: ${process.env.HOSTNAME || require('os').hostname()}</li>
          </ul>
        `;
        
        try {
          await this.sendEmailAll({ subject, htmlContent: html, metadata: { type: 'feed_recovery', feed } });
          await this.setAlertState(feed, { alertActive: false });
          logger?.info?.(`[FeedInactivity] ✅ Recovery email sent for ${feed}. Last seen: ${this.formatTs(lastSeen)}`);
        } catch (emailErr) {
          logger?.error?.(`[FeedInactivity] ❌ Failed to send recovery email for ${feed}: ${emailErr.message}`, { error: emailErr });
          throw emailErr;
        }
      }
    } catch (err) {
      logger?.error?.(`[FeedInactivity] ❌ Error checking feed ${feed}: ${err.message}`, { error: err, stack: err.stack });
      // Don't throw - we want the checker to keep running
    }
  }

  startChecker() {
    if (this.timer) return;
    logger?.info?.(`[FeedInactivity] Starting checker: threshold=${this.thresholdMinutes}min, cooldown=${this.cooldownMinutes}min`);
    this.timer = setInterval(() => {
      // Run checks in parallel but catch errors individually so one failure doesn't stop the other
      this.checkFeed('l1').catch((err) => {
        logger?.error?.(`[FeedInactivity] Unhandled error in L1 check: ${err.message}`, { error: err });
      });
      this.checkFeed('bl2').catch((err) => {
        logger?.error?.(`[FeedInactivity] Unhandled error in BL2 check: ${err.message}`, { error: err });
      });
    }, ONE_MINUTE_MS);
    logger?.info?.(`[FeedInactivity] ✅ Checker started (runs every 1 minute)`);
  }

  stopChecker() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

let singletonInstance = null;
function getFeedInactivityMonitor() {
  if (!singletonInstance) {
    singletonInstance = new FeedInactivityMonitor();
  }
  return singletonInstance;
}

module.exports = {
  getFeedInactivityMonitor,
};


