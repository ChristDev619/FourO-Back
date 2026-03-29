const {
  AlarmAggregation,
  MachineStateAggregation,
  Op
} = require("../../dbInit");

const logger = require("../logger");
const { JobNotFoundError } = require("../errors");
const { notifyAggregationFailure } = require("../services/AggregationFailureNotifier");

const {
  aggregateAlarms,
  aggregateAlarmsSQL,
  aggregateMachineStates
} = require("../../controllers/TagAggregates.controller");

/**
 * Recalculate all types of aggregates after job closure:
 * - Alarms and machine states for the job
 * - Tag value aggregates: hourly, daily, weekly, monthly (global)
 */
async function recalculateAggregatesForJob(jobId, transaction) {

console.log("🔍 DEBUG: Entering recalculateAggregatesForJob function", { jobId });

// Log recalculation process start
logger.info("Starting recalculation process", { 
  jobId, 
  process: "aggregate_recalculation",
  timestamp: new Date().toISOString()
});

// Notify recalculation process start
try {
  const { getGlobalJobNotificationService } = require("../services/GlobalJobNotificationService");
  const jobNotificationService = getGlobalJobNotificationService();
  if (jobNotificationService && typeof jobNotificationService.notifyJobCompletion === 'function') {
    await jobNotificationService.notifyJobCompletion(
      jobId,
      'success',
      'Recalculation process started',
      { section: 'recalculation_start', started: true }
    );
    logger.info('Sent recalculation start notification', { jobId });
  }
} catch (notificationError) {
  logger.warn('Failed to send recalculation start notification', { jobId, error: notificationError.message });
}

  let alarmDataMap;

  try {
    // Step 1: Save existing alarm reasons and notes before destruction
    const existingAlarmData = await AlarmAggregation.findAll({
      where: { 
        jobId,
        [Op.or]: [
          { alarmReasonId: { [Op.not]: null } },
          { alarmNote: { [Op.not]: null } }
        ]
      },
      attributes: [
        'machineId', 
        'tagId', 
        'alarmCode', 
        'alarmStartDateTime', 
        'alarmEndDateTime',
        'alarmReasonId', 
        'alarmReasonName', 
        'alarmNote'
      ],
      transaction
    });

    // Create a lookup map for existing alarm data
    alarmDataMap = new Map();
    existingAlarmData.forEach(alarm => {
      // Create a unique key for each alarm based on machine, tag, code, and time
      const key = `${alarm.machineId}_${alarm.tagId}_${alarm.alarmCode}_${alarm.alarmStartDateTime}_${alarm.alarmEndDateTime}`;
      alarmDataMap.set(key, {
        alarmReasonId: alarm.alarmReasonId,
        alarmReasonName: alarm.alarmReasonName,
        alarmNote: alarm.alarmNote
      });
    });

    // Step 2: Destroy existing aggregations
    await AlarmAggregation.destroy({ where: { jobId }, transaction });
    await MachineStateAggregation.destroy({ where: { jobId }, transaction });
  } catch (prepareError) {
    logger.error('Aggregation prepare failed (load/destroy)', { jobId, error: prepareError.message, stack: prepareError.stack });
    await notifyAggregationFailure({ phase: 'aggregation_prepare', jobId, error: prepareError });
    throw prepareError;
  }

  try {
    // Step 3: Recreate aggregations (using JavaScript-based function with correct alarm sequence detection)
    await aggregateAlarms(jobId, transaction);
  } catch (alarmAggError) {
    logger.error('Alarm aggregation failed', { jobId, error: alarmAggError.message, stack: alarmAggError.stack });
    await notifyAggregationFailure({ phase: 'alarm_aggregation', jobId, error: alarmAggError });
    throw alarmAggError;
  }
  
  // Notify alarm aggregation completion
  try {
    const { getGlobalJobNotificationService } = require("../services/GlobalJobNotificationService");
    const jobNotificationService = getGlobalJobNotificationService();
    if (jobNotificationService && typeof jobNotificationService.notifyJobCompletion === 'function') {
      await jobNotificationService.notifyJobCompletion(
        jobId,
        'success',
        'Alarm aggregation completed successfully',
        { section: 'alarm_aggregation', completed: true }
      );
      logger.info('Sent alarm aggregation notification', { jobId });
    }
  } catch (notificationError) {
    logger.warn('Failed to send alarm aggregation notification', { jobId, error: notificationError.message });
  }

  try {
    await aggregateMachineStates(jobId, transaction);
  } catch (machineStateError) {
    logger.error('Machine state aggregation failed', { jobId, error: machineStateError.message, stack: machineStateError.stack });
    await notifyAggregationFailure({ phase: 'machine_state_aggregation', jobId, error: machineStateError });
    throw machineStateError;
  }
  
  // Notify machine state aggregation completion
  try {
    const { getGlobalJobNotificationService } = require("../services/GlobalJobNotificationService");
    const jobNotificationService = getGlobalJobNotificationService();
    if (jobNotificationService && typeof jobNotificationService.notifyJobCompletion === 'function') {
      await jobNotificationService.notifyJobCompletion(
        jobId,
        'success',
        'Machine state aggregation completed successfully',
        { section: 'machine_state_aggregation', completed: true }
      );
      logger.info('Sent machine state aggregation notification', { jobId });
    }
  } catch (notificationError) {
    logger.warn('Failed to send machine state aggregation notification', { jobId, error: notificationError.message });
  }

  try {
    // Step 4: Restore the saved alarm reasons and notes
    if (alarmDataMap.size > 0) {
      const newAlarms = await AlarmAggregation.findAll({
        where: { jobId },
        transaction
      });

      for (const newAlarm of newAlarms) {
        const key = `${newAlarm.machineId}_${newAlarm.tagId}_${newAlarm.alarmCode}_${newAlarm.alarmStartDateTime}_${newAlarm.alarmEndDateTime}`;
        const savedData = alarmDataMap.get(key);
        
        if (savedData) {
          await newAlarm.update({
            alarmReasonId: savedData.alarmReasonId,
            alarmReasonName: savedData.alarmReasonName,
            alarmNote: savedData.alarmNote
          }, { transaction });
        }
      }
    }

    // --- TEMP FIX: Delete alarm durations > 15min (REMOVE LATER) --- //christ to check to remove later ask joelle about this
    // Scope deletion to KL1 (lineId 22) Robopac (machineId 14) FirstFault tag (tagId 119)
    await AlarmAggregation.destroy({
      where: {
        jobId,
        lineId: 22,
        machineId: 14,
        tagId: 119,
        duration: { [Op.gt]: 20 }
      },
      transaction
    });
  } catch (postProcessError) {
    logger.error('Aggregation post-process failed (restore reasons / temp delete)', { jobId, error: postProcessError.message, stack: postProcessError.stack });
    await notifyAggregationFailure({ phase: 'aggregation_post_process', jobId, error: postProcessError });
    throw postProcessError;
  }

  // Step 5: OEE Time Series recalculation
  try {
    logger.info("Starting OEE Time Series calculation", { jobId });
    const OEETimeSeriesService = require("../services/OEETimeSeriesService");
    const { OEETimeSeries } = require("../../dbInit");
    const oeeTimeSeriesService = new OEETimeSeriesService({ OEETimeSeries });
    await oeeTimeSeriesService.recalculateOEETimeSeriesForJob(jobId);
    logger.info("Completed OEE Time Series calculation", { jobId });
    
    // Notify OEE Time Series completion
    try {
      const { getGlobalJobNotificationService } = require("../services/GlobalJobNotificationService");
      const jobNotificationService = getGlobalJobNotificationService();
      if (jobNotificationService && typeof jobNotificationService.notifyJobCompletion === 'function') {
        await jobNotificationService.notifyJobCompletion(
          jobId,
          'success',
          'OEE Time Series calculation completed successfully',
          { section: 'oee_timeseries', completed: true }
        );
        logger.info('Sent OEE Time Series completion notification', { jobId });
      }
    } catch (notificationError) {
      logger.warn('Failed to send OEE Time Series notification', { jobId, error: notificationError.message });
    }
  } catch (oeeError) {
    logger.error("OEE Time Series calculation failed", { 
      jobId, 
      error: oeeError.message,
      stack: oeeError.stack 
    });
    
    // If the job doesn't exist at all, fail the entire recalculation
    // Use type-safe instanceof check instead of brittle string matching
    if (oeeError instanceof JobNotFoundError) {
      logger.error("Job not found - failing entire recalculation", { 
        jobId,
        errorCode: oeeError.code,
        errorMetadata: oeeError.metadata
      });
      await notifyAggregationFailure({
        phase: 'oee_timeseries_job_not_found',
        jobId,
        error: oeeError,
        extra: { errorCode: oeeError.code },
      });
      throw oeeError; // Re-throw to trigger Bull retry/DLQ
    }

    await notifyAggregationFailure({ phase: 'oee_timeseries', jobId, error: oeeError });
    
    // Notify OEE Time Series failure
    try {
      const { getGlobalJobNotificationService } = require("../services/GlobalJobNotificationService");
      const jobNotificationService = getGlobalJobNotificationService();
      if (jobNotificationService && typeof jobNotificationService.notifyJobCompletion === 'function') {
        await jobNotificationService.notifyJobCompletion(
          jobId,
          'error',
          'OEE Time Series calculation failed',
          { section: 'oee_timeseries', completed: false, error: oeeError.message }
        );
        logger.info('Sent OEE Time Series error notification', { jobId });
      }
    } catch (notificationError) {
      logger.warn('Failed to send OEE Time Series error notification', { jobId, error: notificationError.message });
    }
    
    // Don't fail the entire recalculation if OEE calculation fails
    // OEE is supplementary data, not critical for job completion
  }

  // Log recalculation process completion
  logger.info("Completed recalculation process", { 
    jobId, 
    process: "aggregate_recalculation",
    status: "completed",
    timestamp: new Date().toISOString()
  });
}
 
module.exports = {
  recalculateAggregatesForJob
};