const { Job, Program, Line } = require('../../dbInit');
const EmailService = require('./EmailService');
const logger = require('../logger');
const moment = require('moment');
const { Op } = require('sequelize');

// Static recipients (matching FeedInactivityMonitor pattern)
const RECIPIENTS = [
  'christian_chindy@hotmail.com',
    'joelle@fourosolutions.com',
    'falam@teknologix-automation.com'
];

/**
 * DuplicateJobMonitorService
 * 
 * Monitors for duplicate jobs created under the same programId
 * Sends daily email alerts when duplicates are detected
 * 
 * Purpose: Detect when bulk operations create multiple jobs for the same program
 * Schedule: Runs daily at 10:00 AM UTC (12:00 PM Beirut time)
 */
class DuplicateJobMonitorService {
  constructor() {
    this.isRunning = false;
  }

  /**
   * Check for duplicate jobs by programId
   * Executes the SQL query: 
   * SELECT programId, COUNT(*) AS count_used
   * FROM Jobs
   * GROUP BY programId
   * HAVING COUNT(*) > 1
   * 
   * @returns {Promise<Array>} Array of duplicates with job details
   */
  async checkDuplicateJobs() {
    try {
      logger.info('[DuplicateJobMonitor] Starting duplicate job check...');

      // Query to find programIds with multiple jobs
      const duplicates = await Job.findAll({
        attributes: [
          'programId',
          [Job.sequelize.fn('COUNT', Job.sequelize.col('id')), 'count_used']
        ],
        where: {
          programId: {
            [Op.ne]: null // Only consider jobs with a programId
          }
        },
        group: ['programId'],
        having: Job.sequelize.literal('COUNT(id) > 1'),
        raw: true
      });

      if (duplicates.length === 0) {
        logger.info('[DuplicateJobMonitor] ✅ No duplicate jobs found');
        return [];
      }

      logger.warn(`[DuplicateJobMonitor] ⚠️ Found ${duplicates.length} programId(s) with duplicate jobs`);

      // Get detailed information for each duplicate programId
      const programIds = duplicates.map(d => d.programId);
      
      const jobDetails = await Job.findAll({
        where: {
          programId: {
            [Op.in]: programIds
          }
        },
        include: [
          {
            model: Line,
            as: 'line',
            attributes: ['id', 'name']
          },
          {
            model: Program,
            as: 'program',
            attributes: ['id', 'number', 'programName']
          }
        ],
        order: [
          ['programId', 'ASC'],
          ['actualStartTime', 'DESC']
        ]
      });

      // Group jobs by programId
      const duplicatesByProgram = {};
      duplicates.forEach(dup => {
        const programId = dup.programId;
        const jobs = jobDetails.filter(j => j.programId === programId);
        
        duplicatesByProgram[programId] = {
          programId: programId,
          count: parseInt(dup.count_used, 10),
          program: jobs[0]?.program,
          jobs: jobs.map(job => ({
            id: job.id,
            jobName: job.jobName,
            actualStartTime: job.actualStartTime,
            actualEndTime: job.actualEndTime,
            lineId: job.lineId,
            lineName: job.line?.name || 'Unknown',
            createdAt: job.createdAt
          }))
        };
      });

      return Object.values(duplicatesByProgram);

    } catch (error) {
      logger.error('[DuplicateJobMonitor] ❌ Error checking duplicate jobs', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Format timestamp for display
   */
  formatTimestamp(ts) {
    if (!ts) return 'N/A';
    try {
      return moment(ts).utc().format('YYYY-MM-DD HH:mm:ss [UTC]');
    } catch {
      return String(ts);
    }
  }

  /**
   * Generate HTML email content for duplicate jobs
   */
  generateEmailHtml(duplicates) {
    const totalDuplicates = duplicates.length;
    const totalJobs = duplicates.reduce((sum, dup) => sum + dup.count, 0);

    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">🚨 Duplicate Job Alert - Daily Report</h2>
        
        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
          <p><strong>Summary:</strong></p>
          <ul>
            <li><strong>${totalDuplicates}</strong> program(s) have duplicate jobs</li>
            <li><strong>${totalJobs}</strong> total jobs affected</li>
            <li>Report generated: <strong>${this.formatTimestamp(new Date())}</strong></li>
          </ul>
        </div>

        <p>The following programs have multiple jobs created under the same programId. This indicates duplicate job creation from bulk operations:</p>
    `;

    duplicates.forEach((dup, index) => {
      const programInfo = dup.program 
        ? `${dup.program.programName} (ID: ${dup.program.id}, Number: ${dup.program.number})`
        : `Program ID: ${dup.programId}`;

      html += `
        <div style="background-color: #f5f5f5; border-radius: 5px; padding: 15px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">
            ${index + 1}. ${programInfo}
          </h3>
          <p style="color: #666; margin: 5px 0;">
            <strong>Job Count:</strong> ${dup.count} jobs
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px; background-color: white;">
            <thead>
              <tr style="background-color: #e3f2fd;">
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Job ID</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Job Name</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Line</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Start Time</th>
                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Status</th>
              </tr>
            </thead>
            <tbody>
      `;

      dup.jobs.forEach(job => {
        const status = job.actualEndTime ? 'Closed' : '<strong>Active</strong>';
        html += `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${job.id}</td>
            <td style="border: 1px solid #ddd; padding: 8px; font-size: 12px;">${job.jobName || 'N/A'}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${job.lineName} (${job.lineId})</td>
            <td style="border: 1px solid #ddd; padding: 8px; font-size: 12px;">${this.formatTimestamp(job.actualStartTime)}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${status}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
        </div>
      `;
    });

    html += `
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
          <p>
            <strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}<br>
            <strong>Host:</strong> ${process.env.HOSTNAME || require('os').hostname()}<br>
            <strong>Scheduled Check:</strong> Daily at 10:00 AM UTC (12:00 PM Beirut time)
          </p>
        </div>
      </div>
    `;

    return html;
  }

  /**
   * Send email to all recipients
   */
  async sendEmailAll({ subject, htmlContent, textContent, metadata }) {
    const sendResults = await Promise.allSettled(
      RECIPIENTS.map((to) =>
        EmailService.sendEmail({ to, subject, htmlContent, textContent, metadata })
      )
    );

    // Log results
    sendResults.forEach((result, index) => {
      const recipient = RECIPIENTS[index];
      if (result.status === 'fulfilled' && result.value.success) {
        logger.info(`[DuplicateJobMonitor] ✅ Email sent successfully to ${recipient}`);
      } else {
        logger.error(`[DuplicateJobMonitor] ❌ Failed to send email to ${recipient}`, {
          error: result.reason?.message || result.value?.message
        });
      }
    });

    return sendResults;
  }

  /**
   * Run the daily check and send email if duplicates found
   * Main entry point called by cron scheduler
   */
  async runDailyCheck() {
    // Prevent concurrent runs
    if (this.isRunning) {
      logger.warn('[DuplicateJobMonitor] ⚠️ Check already running, skipping this execution');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('[DuplicateJobMonitor] 🕐 Starting scheduled daily check at 10:00 AM UTC (12:00 PM Beirut)');

      const duplicates = await this.checkDuplicateJobs();

      if (duplicates.length === 0) {
        // No duplicates - optionally send a "all clear" email or just log
        logger.info('[DuplicateJobMonitor] ✅ No duplicate jobs found - no email sent');
        return;
      }

      // Duplicates found - send email alert
      const subject = `🚨 Duplicate Jobs Alert - ${duplicates.length} Program(s) Affected`;
      const htmlContent = this.generateEmailHtml(duplicates);

      await this.sendEmailAll({
        subject,
        htmlContent,
        metadata: {
          type: 'duplicate_jobs_alert',
          duplicateCount: duplicates.length,
          checkTime: new Date().toISOString()
        }
      });

      const duration = Date.now() - startTime;
      logger.info(`[DuplicateJobMonitor] ✅ Daily check completed in ${duration}ms - ${duplicates.length} duplicate(s) reported`);

    } catch (error) {
      logger.error('[DuplicateJobMonitor] ❌ Error in daily check', {
        error: error.message,
        stack: error.stack
      });
      
      // Send error notification email
      try {
        const errorSubject = '❌ Duplicate Job Monitor - Check Failed';
        const errorHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
            <h2 style="color: #d32f2f;">❌ Duplicate Job Monitor Error</h2>
            <p>The scheduled duplicate job check failed to execute:</p>
            <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
              <p><strong>Error:</strong> ${error.message}</p>
              <p><strong>Time:</strong> ${this.formatTimestamp(new Date())}</p>
              <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
            </div>
            <p>Please check the application logs for more details.</p>
          </div>
        `;

        await this.sendEmailAll({
          subject: errorSubject,
          htmlContent: errorHtml,
          metadata: { type: 'duplicate_jobs_error' }
        });
      } catch (emailError) {
        logger.error('[DuplicateJobMonitor] ❌ Failed to send error notification email', {
          error: emailError.message
        });
      }
    } finally {
      this.isRunning = false;
    }
  }
}

// Singleton instance
let singletonInstance = null;

function getDuplicateJobMonitor() {
  if (!singletonInstance) {
    singletonInstance = new DuplicateJobMonitorService();
  }
  return singletonInstance;
}

module.exports = {
  getDuplicateJobMonitor,
  DuplicateJobMonitorService
};

