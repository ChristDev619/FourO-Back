const { JobNotFoundError } = require('../errors');

class OEETimeSeriesService {
  constructor({ OEETimeSeries }) {
    this.OEETimeSeries = OEETimeSeries;
  }

  async saveCurve(jobId, curveArray) {
    // curveArray: [{minute, timestamp, oee, availability, performance, quality}, ...]
    // Bulk insert
    return this.OEETimeSeries.bulkCreate(
      curveArray.map((row, i) => ({
        jobId,
        minute: i,
        ...row
      })),
      { ignoreDuplicates: true }
    );
  }

  async getCurve(jobId) {
    return this.OEETimeSeries.findAll({
      where: { jobId },
      order: [['minute', 'ASC']]
    });
  }

  async recalculateOEETimeSeriesForJob(jobId) {
    const startTime = Date.now();
    const logger = require('../logger');
    
    logger.info("Starting OEE Time Series calculation", { 
      jobId, 
      process: "oee_calculation",
      timestamp: new Date().toISOString()
    });
    
    console.log(`Starting OEE curve calculation for jobId: ${jobId}`);

    try {
      // Import modules
      const { Job, Line, Tags, TagValues, Op } = require("../../dbInit");
      const { calculateOEETimeSeries } = require("../../controllers/OEETimeSeries.controller");
      const TagRefs = require("../constants/TagRefs");
      const dayjs = require("dayjs");

      // 1. Fetch the job and related info
      const job = await Job.findByPk(jobId, {
        attributes: ["id", "actualStartTime", "actualEndTime", "jobName", "lineId", "skuId"],
        raw: true,
      });
      
      if (!job) {
        throw new JobNotFoundError(jobId, {
          context: 'OEETimeSeriesService.recalculateOEETimeSeriesForJob',
          operation: 'fetchJob'
        });
      }

      // 2. Check job duration and determine calculation strategy
      const jobStart = dayjs(job.actualStartTime);
      const jobEnd = dayjs(job.actualEndTime);
      const durationInDays = jobEnd.diff(jobStart, 'day', true);
      const totalMinutes = jobEnd.diff(jobStart, 'minute');
      
      // Aggressive sampling strategy for performance
      let sampleInterval = 1; // minutes
      let maxDataPoints = 1000; // Reduced from 10000 to 1000 for faster processing
      
      if (totalMinutes > 1440) { // > 1 day
        sampleInterval = Math.max(5, Math.ceil(totalMinutes / maxDataPoints)); // At least 5-minute intervals
        console.log(`Job ${jobId} is long (${durationInDays.toFixed(2)} days, ${totalMinutes} minutes). Using ${sampleInterval}-minute sampling for performance.`);
      } else if (totalMinutes > 480) { // > 8 hours
        sampleInterval = 2; // 2-minute intervals
        console.log(`Job ${jobId} duration: ${durationInDays.toFixed(2)} days (${totalMinutes} minutes) - using 2-minute sampling`);
      } else {
        console.log(`Job ${jobId} duration: ${durationInDays.toFixed(2)} days (${totalMinutes} minutes) - using full minute-by-minute calculation`);
      }

      const line = await Line.findByPk(job.lineId);
      if (!line) {
        throw new Error(`Line not found for job: ${jobId}, lineId: ${job.lineId}`);
      }

      const machineId = line.bottleneckMachineId;
      if (!machineId) {
        throw new Error(`No bottleneck machine for line: ${line.id}, job: ${jobId}`);
      }

      console.log(`Calculating OEE curve for jobId: ${jobId} with SKU: ${job.skuId}`);
      
      // 2. Calculate the OEE curve with timeout and sampling
      const CALCULATION_TIMEOUT = totalMinutes > 1440 ? 180000 : 60000; // 3 min for long jobs, 1 min for short
      console.log(`Using ${CALCULATION_TIMEOUT/1000}s timeout for calculation`);
      
      const oeeCurve = await Promise.race([
        calculateOEETimeSeries(job, machineId, line.id, sampleInterval),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`OEE calculation timeout after ${CALCULATION_TIMEOUT/1000} seconds`)), CALCULATION_TIMEOUT)
        )
      ]);

      if (!oeeCurve || oeeCurve.length === 0) {
        throw new Error(`No OEE curve data generated for jobId: ${jobId}`);
      }

      // 3. Filter out invalid data points with detailed debugging
      const validPoints = [];
      const invalidPoints = [];
      
      oeeCurve.forEach((point, idx) => {
        const debugInfo = {
          index: idx,
          timestamp: point.timestamp,
          breakpoints: []
        };

        // Check each metric individually and identify where it breaks
        if (typeof point.oee !== 'number' || isNaN(point.oee)) {
          debugInfo.breakpoints.push({
            metric: 'OEE',
            value: point.oee,
            type: typeof point.oee,
            isNaN: isNaN(point.oee),
            underlyingData: {
              availability: point.availability,
              performance: point.performance,
              quality: point.quality,
              calculation: `(${point.availability} * ${point.performance} * ${point.quality}) / 10000`
            }
          });
        }

        if (typeof point.availability !== 'number' || isNaN(point.availability)) {
          debugInfo.breakpoints.push({
            metric: 'Availability',
            value: point.availability,
            type: typeof point.availability,
            isNaN: isNaN(point.availability),
            underlyingData: point.metrics ? {
              got: point.metrics.got,
              batchDuration: point.metrics.batchDuration,
              calculation: `(${point.metrics.got} / ${point.metrics.batchDuration}) * 100`
            } : null
          });
        }

        if (typeof point.performance !== 'number' || isNaN(point.performance)) {
          debugInfo.breakpoints.push({
            metric: 'Performance',
            value: point.performance,
            type: typeof point.performance,
            isNaN: isNaN(point.performance),
            underlyingData: point.metrics ? {
              not: point.metrics.not,
              got: point.metrics.got,
              calculation: `(${point.metrics.not} / ${point.metrics.got}) * 100`
            } : null
          });
        }

        if (typeof point.quality !== 'number' || isNaN(point.quality)) {
          debugInfo.breakpoints.push({
            metric: 'Quality',
            value: point.quality,
            type: typeof point.quality,
            isNaN: isNaN(point.quality),
            underlyingData: point.metrics ? {
              vot: point.metrics.vot,
              not: point.metrics.not,
              calculation: `(${point.metrics.vot} / ${point.metrics.not}) * 100`
            } : null
          });
        }

        // If any breakpoints found, it's invalid
        if (debugInfo.breakpoints.length > 0) {
          invalidPoints.push({
            ...debugInfo,
            fullPoint: point // Include the full point for complete context
          });
        } else {
          validPoints.push(point);
        }
      });

      if (invalidPoints.length > 0) {
        console.warn(`Found ${invalidPoints.length} invalid OEE data points for jobId ${jobId}, filtering them out. Valid points: ${validPoints.length}`);
        
        // Save detailed breakdown to file for debugging
        const fs = require('fs');
        const path = require('path');
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-');
        
        const debugDir = path.join(__dirname, '../../oee_debug');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        
        const debugFileName = `oee_breakpoints_job${jobId}_${timestamp}.txt`;
        const debugFilePath = path.join(debugDir, debugFileName);
        
        let debugContent = `OEE BREAKPOINT ANALYSIS REPORT\n`;
        debugContent += `=============================================\n`;
        debugContent += `Generated: ${now.toISOString()}\n`;
        debugContent += `Job ID: ${jobId}\n`;
        debugContent += `Invalid Points: ${invalidPoints.length}\n`;
        debugContent += `Valid Points: ${validPoints.length}\n`;
        debugContent += `Analysis Time: ${new Date().toLocaleString()}\n\n`;
        
        invalidPoints.forEach((invalid, idx) => {
          debugContent += `--- Invalid Point #${idx + 1} ---\n`;
          debugContent += `Index: ${invalid.index}\n`;
          debugContent += `Timestamp: ${invalid.timestamp}\n`;
          debugContent += `Created At: ${now.toISOString()}\n`;
          debugContent += `Breakpoints Found: ${invalid.breakpoints.length}\n\n`;
          
          invalid.breakpoints.forEach((bp, bpIdx) => {
            debugContent += `  ${bpIdx + 1}. ${bp.metric} FAILED:\n`;
            debugContent += `     Value: ${bp.value} (type: ${bp.type}, isNaN: ${bp.isNaN})\n`;
            if (bp.underlyingData) {
              debugContent += `     Calculation: ${bp.calculation}\n`;
              debugContent += `     Raw Data:\n`;
              Object.entries(bp.underlyingData).forEach(([key, value]) => {
                debugContent += `       ${key}: ${value}\n`;
              });
            }
            debugContent += `\n`;
          });
          
          // Add full metrics for context
          if (invalid.fullPoint?.metrics) {
            debugContent += `  Full Metrics Context:\n`;
            debugContent += `    VOT: ${invalid.fullPoint.metrics.vot}\n`;
            debugContent += `    GOT: ${invalid.fullPoint.metrics.got}\n`;
            debugContent += `    NOT: ${invalid.fullPoint.metrics.not}\n`;
            debugContent += `    Batch Duration: ${invalid.fullPoint.metrics.batchDuration}\n`;
            debugContent += `    UDT: ${invalid.fullPoint.metrics.udt}\n`;
            debugContent += `    QL: ${invalid.fullPoint.metrics.ql}\n`;
            debugContent += `    SLT: ${invalid.fullPoint.metrics.slt}\n`;
            debugContent += `    SL: ${invalid.fullPoint.metrics.sl}\n`;
          }
          
          debugContent += `\n${'='.repeat(50)}\n\n`;
        });
        
        debugContent += `END OF ANALYSIS\n`;
        debugContent += `Report saved at: ${debugFilePath}\n`;
        
        try {
          fs.writeFileSync(debugFilePath, debugContent, 'utf8');
          console.warn(`\n🔍 OEE breakpoint analysis saved to: ${debugFilePath}`);
          console.warn(`📊 Summary: ${invalidPoints.length} invalid points, ${validPoints.length} valid points for Job ${jobId}`);
        } catch (writeError) {
          console.error(`Failed to write OEE debug file: ${writeError.message}`);
          // Fall back to console logging
          console.warn(`\n=== DETAILED OEE BREAKPOINT ANALYSIS for Job ${jobId} ===`);
          console.warn(debugContent);
          console.warn(`=== END BREAKPOINT ANALYSIS ===\n`);
        }
      }

      if (validPoints.length === 0) {
        console.warn(`No valid OEE data points found for jobId: ${jobId}`);
        return; // Exit early if no valid data
      }

      // 4. Use transaction for atomic operation
      const sequelize = this.OEETimeSeries.sequelize;
      await sequelize.transaction(async (t) => {
        // Delete old curve for this job
        console.log(`Deleting old OEE curve for jobId: ${jobId}`);
        await this.OEETimeSeries.destroy({ 
          where: { jobId },
          transaction: t 
        });

        // Insert new curve (only valid points)
        console.log(`Inserting new OEE curve for jobId: ${jobId} (${validPoints.length} valid points)`);
        await this.OEETimeSeries.bulkCreate(
          validPoints.map((point, idx) => ({
            jobId,
            minute: idx,
            timestamp: point.timestamp,
            oee: point.oee,
            availability: point.availability,
            performance: point.performance,
            quality: point.quality,
            bottleCount: point.state,
          })),
          { transaction: t }
        );
      });

      const duration = Date.now() - startTime;
      
      logger.info("Completed OEE Time Series calculation", { 
        jobId, 
        process: "oee_calculation",
        status: "completed",
        duration: `${duration}ms`,
        dataPoints: validPoints.length,
        timestamp: new Date().toISOString()
      });
      
      console.log(`Successfully completed OEE curve calculation for jobId: ${jobId} in ${duration}ms`);

    } catch (err) {
      const duration = Date.now() - startTime;
      
      logger.error("OEE Time Series calculation failed", { 
        jobId, 
        process: "oee_calculation",
        status: "failed",
        duration: `${duration}ms`,
        error: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
      });
      
      console.error(`OEE curve calculation failed for jobId: ${jobId} after ${duration}ms`, {
        error: err.message,
        stack: err.stack,
        jobId
      });
      throw err;
    }
  }
}

module.exports = OEETimeSeriesService;