const crypto = require('crypto');
const emailConfig = require('../../config/email.config');
const emailService = require('./EmailService');
const logger = require('../logger');

const lastSuccessfulSend = new Map();
const COOLDOWN_MS = parseInt(process.env.AGGREGATION_ALERT_COOLDOWN_MS || '600000', 10);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isThrottled(jobId, phase) {
  const key = `${jobId}|${phase}`;
  const prev = lastSuccessfulSend.get(key);
  return prev != null && Date.now() - prev < COOLDOWN_MS;
}

function markSuccessfulSend(jobId, phase) {
  lastSuccessfulSend.set(`${jobId}|${phase}`, Date.now());
}

/**
 * Send one operational email when an aggregation / recalculation step fails.
 * Does not throw; logs on failure. Throttles duplicate alerts per job+phase (default 10 min).
 *
 * @param {Object} params
 * @param {string} params.phase - e.g. alarm_aggregation, machine_state_aggregation, oee_timeseries
 * @param {number|string} params.jobId
 * @param {Error|string} params.error
 * @param {Object} [params.extra] - optional serializable context (queueJobId, attempts, etc.)
 */
async function notifyAggregationFailure({ phase, jobId, error, extra = {} }) {
  const alerts = emailConfig.operationalAlerts;
  if (!alerts || !alerts.enableAggregationFailureEmail) {
    return;
  }

  const recipients = alerts.aggregationFailureRecipients || [];
  if (recipients.length === 0) {
    logger.warn('Aggregation failure email skipped: no recipients', { phase, jobId });
    return;
  }

  if (isThrottled(jobId, phase)) {
    logger.info('Aggregation failure email throttled (cooldown)', { jobId, phase, cooldownMs: COOLDOWN_MS });
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const correlationId = crypto.randomUUID();
  const subject = `[FourO] Aggregation failure: ${phase} (job ${jobId})`;

  const extraLines = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `<tr><td style="padding:4px 8px;border:1px solid #ddd;"><strong>${escapeHtml(k)}</strong></td><td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`)
    .join('');

  const htmlContent = `
    <p><strong>Phase:</strong> ${escapeHtml(phase)}</p>
    <p><strong>Job ID:</strong> ${escapeHtml(String(jobId))}</p>
    <p><strong>Time (UTC):</strong> ${escapeHtml(new Date().toISOString())}</p>
    <p><strong>Correlation:</strong> ${escapeHtml(correlationId)}</p>
    <p><strong>Message:</strong> ${escapeHtml(err.message)}</p>
    <pre style="background:#f5f5f5;padding:12px;overflow:auto;font-size:12px;">${escapeHtml(err.stack || '')}</pre>
    ${extraLines ? `<table style="border-collapse:collapse;margin-top:12px;">${extraLines}</table>` : ''}
  `.trim();

  const textExtra = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');

  const textContent = [
    `Phase: ${phase}`,
    `Job ID: ${jobId}`,
    `Time (UTC): ${new Date().toISOString()}`,
    `Correlation: ${correlationId}`,
    `Message: ${err.message}`,
    err.stack || '',
    textExtra || undefined,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const result = await emailService.sendEmail({
      to: recipients,
      subject,
      htmlContent,
      textContent,
      metadata: {
        type: 'aggregation_failure',
        phase,
        jobId: String(jobId),
        correlationId,
      },
    });

    if (result.success) {
      markSuccessfulSend(jobId, phase);
      logger.info('Aggregation failure alert email sent', { jobId, phase, correlationId });
    }
  } catch (notifyErr) {
    logger.error('AggregationFailureNotifier: unexpected error', {
      jobId,
      phase,
      error: notifyErr.message,
    });
  }
}

module.exports = {
  notifyAggregationFailure,
};
