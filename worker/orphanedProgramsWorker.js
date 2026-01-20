/**
 * Orphaned Programs Worker
 * 
 * Monitors and reports programs that have no associated jobs.
 * Runs on a scheduled basis (every 5 days by default) and sends
 * email notifications to Business Analyst when orphaned programs are detected.
 * 
 * @module orphanedProgramsWorker
 */

require('dotenv').config();

const cron = require('node-cron');
const logger = require('../utils/logger');
const OrphanedProgramsService = require('../utils/services/OrphanedProgramsService');
const EmailService = require('../utils/services/EmailService');

// Configuration
const BA_EMAIL = process.env.BA_EMAIL || process.env.ADMIN_EMAIL;
const CRON_SCHEDULE = process.env.ORPHANED_PROGRAMS_CHECK_SCHEDULE || '0 0 */5 * *'; // Every 5 days at midnight UTC
const MANUAL_MODE = process.argv.includes('--manual');

/**
 * Generate HTML email content for orphaned programs notification
 */
function generateEmailContent(summary) {
  const { count, programIds, programs } = summary;
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Generate programs table rows
  const programRows = programs
    .map(
      (p) => `
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">${p.id}</td>
      <td style="border: 1px solid #ddd; padding: 8px;">${p.number || 'N/A'}</td>
      <td style="border: 1px solid #ddd; padding: 8px;">${p.programName || 'N/A'}</td>
      <td style="border: 1px solid #ddd; padding: 8px;">${p.startDate}</td>
      <td style="border: 1px solid #ddd; padding: 8px;">${p.endDate}</td>
      <td style="border: 1px solid #ddd; padding: 8px;">${p.lineId || 'N/A'}</td>
    </tr>
  `
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .alert { background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
    .info-box { background-color: #e7f3ff; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background-color: #f8f9fa; border: 1px solid #ddd; padding: 12px; text-align: left; font-weight: bold; }
    td { border: 1px solid #ddd; padding: 8px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
    .code-block { background-color: #f4f4f4; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px; margin: 10px 0; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; color: #333;">🔔 FourO Alert: Orphaned Programs Detected</h1>
      <p style="margin: 5px 0 0 0; color: #666;">Date: ${currentDate}</p>
    </div>

    <div class="alert">
      <strong>⚠️ Action Required:</strong> ${count} orphaned program${count !== 1 ? 's' : ''} detected in the system.
    </div>

    <div class="info-box">
      <h3 style="margin-top: 0;">Summary</h3>
      <ul>
        <li><strong>Total Orphaned Programs:</strong> ${count}</li>
        <li><strong>Program IDs:</strong> ${programIds || 'None'}</li>
      </ul>
    </div>

    <h3>Program Details</h3>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Number</th>
          <th>Program Name</th>
          <th>Start Date</th>
          <th>End Date</th>
          <th>Line ID</th>
        </tr>
      </thead>
      <tbody>
        ${programRows || '<tr><td colspan="6" style="text-align: center;">No orphaned programs found</td></tr>'}
      </tbody>
    </table>

    <div class="info-box">
      <h3 style="margin-top: 0;">Next Steps</h3>
      <ol>
        <li><strong>Review</strong> the list of orphaned program IDs above</li>
        <li><strong>Verify</strong> if these programs should have jobs assigned</li>
        <li><strong>Investigate</strong> why jobs were not created (data entry issue, system bug, etc.)</li>
        <li><strong>Take Action</strong>:
          <ul>
            <li>If programs should have jobs: Create missing jobs</li>
            <li>If programs are obsolete: Delete them using the SQL query below</li>
            <li>If investigation needed: Document findings and escalate</li>
          </ul>
        </li>
      </ol>
    </div>

    <div class="alert">
      <strong>⚠️ SQL Query for Deletion (Use with Caution):</strong>
      <div class="code-block">
START TRANSACTION;<br><br>
DELETE p<br>
FROM aquafinaflexibleserverdb.programs p<br>
LEFT JOIN aquafinaflexibleserverdb.jobs j<br>
  ON j.programId = p.id<br>
WHERE j.id IS NULL;<br><br>
-- Review affected rows, then:<br>
-- COMMIT;  (to save changes)<br>
-- ROLLBACK;  (to undo)
      </div>
      <p style="margin: 10px 0 0 0;"><strong>Always backup before deletion!</strong></p>
    </div>

    <div class="footer">
      <p>This is an automated notification from the FourO Platform.</p>
      <p>Worker runs every 5 days. To disable or modify, contact the development team.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate plain text version of email
 */
function generatePlainTextContent(summary) {
  const { count, programIds, programs } = summary;
  const currentDate = new Date().toLocaleDateString();

  let text = `FourO Alert: Orphaned Programs Detected\n`;
  text += `Date: ${currentDate}\n\n`;
  text += `⚠️ Action Required: ${count} orphaned program${count !== 1 ? 's' : ''} detected.\n\n`;
  text += `Summary:\n`;
  text += `- Total Orphaned Programs: ${count}\n`;
  text += `- Program IDs: ${programIds || 'None'}\n\n`;
  text += `Program Details:\n`;
  text += `ID | Number | Program Name | Start Date | End Date | Line ID\n`;
  text += `${'-'.repeat(80)}\n`;

  programs.forEach((p) => {
    text += `${p.id} | ${p.number || 'N/A'} | ${p.programName || 'N/A'} | ${p.startDate} | ${p.endDate} | ${p.lineId || 'N/A'}\n`;
  });

  text += `\nNext Steps:\n`;
  text += `1. Review the list of orphaned program IDs\n`;
  text += `2. Verify if these programs should have jobs assigned\n`;
  text += `3. Investigate why jobs were not created\n`;
  text += `4. Take appropriate action (create jobs, delete programs, or investigate)\n`;

  return text;
}

/**
 * Check for orphaned programs and send email notification
 */
async function checkAndNotifyOrphanedPrograms() {
  const startTime = Date.now();

  try {
    logger.info('🔍 Starting orphaned programs check', {
      mode: MANUAL_MODE ? 'manual' : 'scheduled',
    });

    // Get orphaned programs summary
    const summary = await OrphanedProgramsService.getOrphanedProgramsSummary();

    if (summary.count === 0) {
      logger.info('✅ No orphaned programs found', {
        duration: Date.now() - startTime,
      });
      return { success: true, count: 0, message: 'No orphaned programs found' };
    }

    // Check if BA email is configured
    if (!BA_EMAIL) {
      logger.warn('⚠️ BA_EMAIL not configured. Skipping email notification.', {
        orphanedCount: summary.count,
      });
      return {
        success: true,
        count: summary.count,
        message: 'Orphaned programs found but email not sent (BA_EMAIL not configured)',
      };
    }

    // Generate email content
    const htmlContent = generateEmailContent(summary);
    const textContent = generatePlainTextContent(summary);

    // Send email
    const emailResult = await EmailService.sendEmail({
      to: BA_EMAIL,
      subject: `🔔 FourO Alert: ${summary.count} Orphaned Program${summary.count !== 1 ? 's' : ''} Detected`,
      htmlContent,
      textContent,
      metadata: {
        type: 'orphaned_programs_alert',
        count: summary.count,
        programIds: summary.programIds,
        mode: MANUAL_MODE ? 'manual' : 'scheduled',
      },
    });

    const duration = Date.now() - startTime;

    if (emailResult.success) {
      logger.info('✅ Orphaned programs check completed and email sent', {
        count: summary.count,
        baEmail: BA_EMAIL,
        duration: `${duration}ms`,
        messageId: emailResult.messageId,
      });
      return {
        success: true,
        count: summary.count,
        emailSent: true,
        messageId: emailResult.messageId,
      };
    } else {
      logger.error('❌ Failed to send orphaned programs email', {
        count: summary.count,
        baEmail: BA_EMAIL,
        error: emailResult.error,
        duration: `${duration}ms`,
      });
      return {
        success: false,
        count: summary.count,
        emailSent: false,
        error: emailResult.error,
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('❌ Error in orphaned programs check', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`,
    });
    throw error;
  }
}

/**
 * Initialize Worker
 */
function initializeWorker() {
  if (MANUAL_MODE) {
    // Run immediately in manual mode
    logger.info('🚀 Running orphaned programs check in MANUAL mode');
    checkAndNotifyOrphanedPrograms()
      .then((result) => {
        logger.info('Manual check completed', result);
        process.exit(result.success ? 0 : 1);
      })
      .catch((error) => {
        logger.error('Manual check failed', { error: error.message });
        process.exit(1);
      });
  } else {
    // Schedule cron job
    logger.info('📅 Scheduling orphaned programs check', {
      schedule: CRON_SCHEDULE,
      baEmail: BA_EMAIL || 'NOT CONFIGURED',
    });

    cron.schedule(
      CRON_SCHEDULE,
      async () => {
        logger.info('⏰ Scheduled orphaned programs check triggered');
        try {
          await checkAndNotifyOrphanedPrograms();
        } catch (error) {
          logger.error('❌ Unhandled error in scheduled orphaned programs check', {
            error: error.message,
            stack: error.stack,
          });
        }
      },
      {
        timezone: 'UTC',
      }
    );

    logger.info('✅ Orphaned programs worker initialized', {
      schedule: CRON_SCHEDULE,
      nextRun: 'Every 5 days at midnight UTC',
    });
    console.log('✅ Orphaned Programs Worker scheduled: Every 5 days at midnight UTC');
  }
}

// Initialize worker
initializeWorker();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Orphaned programs worker received SIGTERM - shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Orphaned programs worker received SIGINT - shutting down gracefully');
  process.exit(0);
});

// Error handlers
process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION in orphaned programs worker', { reason });
});

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION in orphaned programs worker', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

if (!MANUAL_MODE) {
  logger.info('🔍 Orphaned programs worker started and scheduled...');
}

