const express = require('express');
const router = express.Router();
const { getDuplicateJobMonitor } = require('../utils/services/DuplicateJobMonitorService');
const logger = require('../utils/logger');

/**
 * @route   POST /api/duplicate-job-monitor/trigger
 * @desc    Manually trigger duplicate job check (for testing)
 * @access  Internal/Admin only
 */
router.post('/trigger', async (req, res) => {
    try {
        logger.info('[DuplicateJobMonitor] Manual trigger requested via API');
        
        const monitor = getDuplicateJobMonitor();
        
        // Run the check (this will send email if duplicates found)
        await monitor.runDailyCheck();
        
        res.status(200).json({
            success: true,
            message: 'Duplicate job check completed successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[DuplicateJobMonitor] Error in manual trigger', {
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to run duplicate job check'
        });
    }
});

/**
 * @route   GET /api/duplicate-job-monitor/preview
 * @desc    Preview duplicate jobs without sending email
 * @access  Internal/Admin only
 */
router.get('/preview', async (req, res) => {
    try {
        logger.info('[DuplicateJobMonitor] Preview requested via API');
        
        const monitor = getDuplicateJobMonitor();
        
        // Check for duplicates without sending email
        const duplicates = await monitor.checkDuplicateJobs();
        
        res.status(200).json({
            success: true,
            duplicateCount: duplicates.length,
            duplicates: duplicates,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[DuplicateJobMonitor] Error in preview', {
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to preview duplicate jobs'
        });
    }
});

module.exports = router;

