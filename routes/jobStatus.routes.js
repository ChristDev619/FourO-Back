const express = require('express');
const router = express.Router();
const { getJobStatusService } = require('../utils/services/JobStatusService');

// Get job status
router.get('/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const jobStatusService = getJobStatusService();
        const status = await jobStatusService.getJobStatus(jobId);
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Error getting job status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get job status',
            error: error.message
        });
    }
});

// Get multiple job statuses
router.post('/batch', async (req, res) => {
    try {
        const { jobIds } = req.body;
        
        if (!Array.isArray(jobIds)) {
            return res.status(400).json({
                success: false,
                message: 'jobIds must be an array'
            });
        }
        
        const jobStatusService = getJobStatusService();
        const statuses = await Promise.all(
            jobIds.map(jobId => jobStatusService.getJobStatus(jobId))
        );
        
        res.json({
            success: true,
            data: statuses
        });
    } catch (error) {
        console.error('Error getting batch job statuses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get batch job statuses',
            error: error.message
        });
    }
});

module.exports = router;
