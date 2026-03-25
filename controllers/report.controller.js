const {
    Report,
    sequelize,
    Line,
    Job,
    Machine,
    AlarmAggregation,
    Alarm,
    Tags,
    TagValues,
    Op,
    Program,
    Recipie,
    UserReportOrder,
    Sku,
    Meters,
    Unit,
    Generator,
    GeneratorMeter,
    TariffUsage,
    Tariff,
    Location,
    TariffType,
    Settings,
} = require("../dbInit");
const dayjs = require("dayjs");
const { LIVE_REPORT_WALL_TIMEZONE, liveInstantFromDbDate } = require("../utils/liveReportTime");
const { parseGanttTimeWindow, calculateGanttTimeWindow, GANTT_ZOOM_CONFIG } = require("../utils/ganttTimeWindow");
const { QueryTypes } = require("sequelize");
const TagRefs = require("../utils/constants/TagRefs");
const STATE_CONFIG = require("../utils/constants/StateConfig");
const { generateAlarmJoinCondition } = require("../utils/alarmUtils");
const {
    getTagValuesDifference,
    getProductionCountWithFallback,
    formatAlarms,
    prepareParetoData,
    prepareWaterfallData,
    getMechanicalDowntime,
    mergeOverlappingBreakdowns,
    calculateEmsMetrics,
    calculateManHourMetrics,
} = require("./report.utils.js");

// Helper function to get current (latest) tag value for live reports
async function getCurrentTagValue(tagId) {
    try {
        const latestValue = await TagValues.findOne({
            where: { tagId },
            order: [['createdAt', 'DESC']],
            attributes: ['value', 'createdAt'],
            raw: true
        });
        
        if (!latestValue) {
            console.log(`[LIVE REPORT] No tag value found for tagId: ${tagId}`);
            return null;
        }
        
        console.log(`[LIVE REPORT] Current value for tag ${tagId}: ${latestValue.value} (at ${latestValue.createdAt})`);
        return parseFloat(latestValue.value) || 0;
    } catch (error) {
        console.error(`[LIVE REPORT] Error getting current tag value for ${tagId}:`, error);
        return null;
    }
}

// Helper function to get live alarms from TagValues for running jobs
async function getLiveAlarms({ job, machineIds, sequelize, QueryTypes, Tags, TagValues, Op, Machine, Alarm, generateAlarmJoinCondition }) {
    try {
        console.log(`\n[LIVE ALARMS] Fetching real-time alarms for running job ${job.id}`);
        console.log(`  Job Start: ${job.actualStartTime}`);
        console.log(`  Job End: NOW() (job still running)`);
        console.log(`  Machine IDs: ${machineIds.join(', ')}`);
        
        // Step 1: Get all alarm tags for the machines in this job
        const alarmTags = await Tags.findAll({
            where: {
                taggableId: { [Op.in]: machineIds },
                taggableType: 'machine',
                ref: { [Op.in]: ['alarm', 'bd'] } // alarm or breakdown tags
            },
            attributes: ['id', 'name', 'ref', 'taggableId'],
            raw: true
        });
        
        if (!alarmTags || alarmTags.length === 0) {
            console.log(`[LIVE ALARMS] No alarm tags found for machines: ${machineIds.join(', ')}`);
            return [];
        }
        
        console.log(`[LIVE ALARMS] Found ${alarmTags.length} alarm tags`);
        const tagIds = alarmTags.map(t => t.id);
        
        // Step 2: Get all TagValues for these alarm tags within job timeframe
        const tagValues = await TagValues.findAll({
            where: {
                tagId: { [Op.in]: tagIds },
                createdAt: {
                    [Op.gte]: job.actualStartTime,
                    [Op.lte]: new Date() // Up to NOW()
                }
            },
            order: [['tagId', 'ASC'], ['createdAt', 'ASC']],
            raw: true
        });
        
        if (!tagValues || tagValues.length === 0) {
            console.log(`[LIVE ALARMS] No tag values found for alarm tags`);
            return [];
        }
        
        console.log(`[LIVE ALARMS] Found ${tagValues.length} tag value records to process`);
        
        // Step 3: Process tag values to identify alarm sequences
        const alarms = [];
        const tagMap = new Map();
        alarmTags.forEach(tag => tagMap.set(tag.id, tag));
        
        // Group values by tagId
        const valuesByTag = {};
        tagValues.forEach(tv => {
            if (!valuesByTag[tv.tagId]) valuesByTag[tv.tagId] = [];
            valuesByTag[tv.tagId].push(tv);
        });
        
        // Process each tag's values
        for (const [tagIdStr, values] of Object.entries(valuesByTag)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);
            if (!tag) continue;
            
            let currentAlarm = null;
            let alarmStartTime = null;
            
            for (let i = 0; i < values.length; i++) {
                const currentValue = values[i];
                const alarmCode = currentValue.value;
                const currentValueTime =
                    liveInstantFromDbDate(currentValue.createdAt)?.toDate?.() ?? currentValue.createdAt;
                
                // Skip if value is "0" or empty (no alarm)
                if (!alarmCode || alarmCode === '0' || alarmCode === 0) {
                    // If we were tracking an alarm, close it
                    if (currentAlarm !== null && alarmStartTime !== null) {
                        const alarmEndTime = currentValueTime;
                        const durationMinutes = dayjs(alarmEndTime).diff(dayjs(alarmStartTime), 'minute', true);
                        
                        // Only include alarms >= 5 minutes
                        if (durationMinutes >= 5) {
                            alarms.push({
                                tagId: tagId,
                                machineId: tag.taggableId,
                                alarmCode: currentAlarm,
                                alarmStartDateTime: alarmStartTime,
                                alarmEndDateTime: alarmEndTime,
                                duration: durationMinutes,
                                alarmReasonName: null,
                                alarmNote: null
                            });
                        }
                        
                        currentAlarm = null;
                        alarmStartTime = null;
                    }
                    continue;
                }
                
                // If alarm code changed, close previous and start new
                if (currentAlarm !== null && currentAlarm !== alarmCode) {
                    const alarmEndTime = currentValueTime;
                    const durationMinutes = dayjs(alarmEndTime).diff(dayjs(alarmStartTime), 'minute', true);
                    
                    if (durationMinutes >= 5) {
                        alarms.push({
                            tagId: tagId,
                            machineId: tag.taggableId,
                            alarmCode: currentAlarm,
                            alarmStartDateTime: alarmStartTime,
                            alarmEndDateTime: alarmEndTime,
                            duration: durationMinutes,
                            alarmReasonName: null,
                            alarmNote: null
                        });
                    }
                }
                
                // Start new alarm or continue existing
                if (currentAlarm !== alarmCode) {
                    currentAlarm = alarmCode;
                    alarmStartTime = currentValueTime;
                }
            }
            
            // Handle alarm that's still active (last value was not "0")
            if (currentAlarm !== null && alarmStartTime !== null) {
                const lastValue = values[values.length - 1];
                const alarmEndTime = new Date(); // Use NOW() for ongoing alarms
                const durationMinutes = dayjs(alarmEndTime).diff(dayjs(alarmStartTime), 'minute', true);
                
                if (durationMinutes >= 5) {
                    alarms.push({
                        tagId: tagId,
                        machineId: tag.taggableId,
                        alarmCode: currentAlarm,
                        alarmStartDateTime: alarmStartTime,
                        alarmEndDateTime: alarmEndTime,
                        duration: durationMinutes,
                        alarmReasonName: null,
                        alarmNote: null
                    });
                    console.log(`[LIVE ALARMS] ⚠️  ONGOING alarm detected: ${currentAlarm} (duration: ${durationMinutes.toFixed(2)} min)`);
                }
            }
        }
        
        if (alarms.length === 0) {
            console.log(`[LIVE ALARMS] No alarms found (>= 5 minutes duration)`);
            return [];
        }
        
        console.log(`[LIVE ALARMS] Processed ${alarms.length} alarms (>= 5 min duration)`);
        
        // Step 4: Enrich alarms with machine names and alarm descriptions
        const enrichedAlarms = [];
        for (const alarm of alarms) {
            // Build custom alarm join condition with literal values (not parameters)
            const alarmJoinCondition = `(
                :alarmCode = a.name OR 
                :alarmCode = TRIM(LEADING '0' FROM a.name) OR 
                TRIM(LEADING '0' FROM :alarmCode) = a.name OR
                TRIM(LEADING '0' FROM :alarmCode) = TRIM(LEADING '0' FROM a.name)
            ) AND a.machineId = :machineId`;
            
            const enrichedAlarmsQuery = `
                SELECT 
                    :tagId as tagId,
                    :machineId as machineId,
                    m.name as machineName,
                    :alarmCode as alarmCode,
                    :alarmStartDateTime as alarmStartDateTime,
                    :alarmEndDateTime as alarmEndDateTime,
                    :duration as duration,
                    :alarmReasonName as alarmReasonName,
                    :alarmNote as alarmNote,
                    a.description as alarm_description
                FROM Machines m
                LEFT JOIN Alarms a ON (${alarmJoinCondition})
                WHERE m.id = :machineId
            `;
            
            const enriched = await sequelize.query(enrichedAlarmsQuery, {
                replacements: {
                    tagId: alarm.tagId,
                    machineId: alarm.machineId,
                    alarmCode: alarm.alarmCode,
                    alarmStartDateTime: alarm.alarmStartDateTime,
                    alarmEndDateTime: alarm.alarmEndDateTime,
                    duration: alarm.duration,
                    alarmReasonName: alarm.alarmReasonName,
                    alarmNote: alarm.alarmNote
                },
                type: QueryTypes.SELECT,
            });
            
            if (enriched && enriched.length > 0) {
                enrichedAlarms.push(enriched[0]);
            }
        }
        
        console.log(`[LIVE ALARMS] Successfully enriched ${enrichedAlarms.length} alarms with machine/alarm details`);
        return enrichedAlarms;
        
    } catch (error) {
        console.error('[LIVE ALARMS] Error fetching live alarms:', error);
        return [];
    }
}

// Helper function to get live machine states from TagValues for running jobs
async function getLiveMachineStates({ job, machineId, sequelize, QueryTypes, Tags, TagValues, Op }) {
    try {
        console.log(`\n[LIVE MACHINE STATES] Fetching real-time machine states for job ${job.id}`);
        console.log(`  Job Start: ${job.actualStartTime}`);
        console.log(`  Job End: NOW() (job still running)`);
        console.log(`  Bottleneck Machine ID: ${machineId}`);
        
        // Step 1: Get machine state tag for the bottleneck machine
        const stateTag = await Tags.findOne({
            where: {
                taggableId: machineId,
                taggableType: 'machine',
                ref: TagRefs.MACHINE_STATE // Machine state tag reference ('mchnst')
            },
            attributes: ['id', 'name', 'ref'],
            raw: true
        });
        
        if (!stateTag) {
            console.log(`[LIVE MACHINE STATES] No state tag found for machine: ${machineId}`);
            return [];
        }
        
        console.log(`[LIVE MACHINE STATES] Found state tag: ${stateTag.name} (ID: ${stateTag.id})`);
        
        // Step 2: Get all TagValues for this state tag within job timeframe
        const tagValues = await TagValues.findAll({
            where: {
                tagId: stateTag.id,
                createdAt: {
                    [Op.gte]: job.actualStartTime,
                    [Op.lte]: new Date() // Up to NOW()
                }
            },
            order: [['createdAt', 'ASC']],
            raw: true
        });
        
        if (!tagValues || tagValues.length === 0) {
            console.log(`[LIVE MACHINE STATES] No tag values found for state tag`);
            return [];
        }
        
        console.log(`[LIVE MACHINE STATES] Processing ${tagValues.length} state values`);
        
        // Step 3: Process tag values to calculate state durations
        // Use Map for efficient state aggregation
        const stateAggregations = new Map();
        let currentState = null;
        let stateStartTime = null;
        
        for (let i = 0; i < tagValues.length; i++) {
            const currentValue = tagValues[i];
            const stateCode = parseInt(currentValue.value);
            
            // If state changed, close previous state
            if (currentState !== null && currentState !== stateCode) {
                const stateEndTime = currentValue.createdAt;
                const durationMinutes = dayjs(stateEndTime).diff(dayjs(stateStartTime), 'minute', true);
                
                // Only include states with duration > 0
                if (durationMinutes > 0) {
                    // Use STATE_CONFIG to get state name (same as TagAggregates.controller.js does)
                    const stateName = STATE_CONFIG.getStateLabel(currentState);
                    
                    // Aggregate durations for same state code
                    if (stateAggregations.has(currentState)) {
                        const existing = stateAggregations.get(currentState);
                        existing.total_duration += durationMinutes;
                    } else {
                        stateAggregations.set(currentState, {
                            stateCode: currentState,
                            stateName: stateName,
                            total_duration: durationMinutes
                        });
                    }
                }
            }
            
            // Start tracking new state
            if (currentState !== stateCode) {
                currentState = stateCode;
                stateStartTime = currentValue.createdAt;
            }
        }
        
        // Handle ongoing state (last value to NOW())
        if (currentState !== null && stateStartTime !== null) {
            const stateEndTime = new Date(); // NOW()
            const durationMinutes = dayjs(stateEndTime).diff(dayjs(stateStartTime), 'minute', true);
            
            if (durationMinutes > 0) {
                const stateName = STATE_CONFIG.getStateLabel(currentState);
                
                if (stateAggregations.has(currentState)) {
                    const existing = stateAggregations.get(currentState);
                    existing.total_duration += durationMinutes;
                } else {
                    stateAggregations.set(currentState, {
                        stateCode: currentState,
                        stateName: stateName,
                        total_duration: durationMinutes
                    });
                }
                console.log(`[LIVE MACHINE STATES] ⚙️  ONGOING state: ${stateName} (duration: ${durationMinutes.toFixed(2)} min)`);
            }
        }
        
        // Convert Map to Array and sort by duration descending
        const states = Array.from(stateAggregations.values());
        states.sort((a, b) => b.total_duration - a.total_duration);
        
        console.log(`[LIVE MACHINE STATES] Calculated ${states.length} state aggregations:`);
        states.forEach(state => {
            console.log(`  - ${state.stateName} (${state.stateCode}): ${state.total_duration.toFixed(2)} minutes`);
        });
        
        return states;
        
    } catch (error) {
        console.error('[LIVE MACHINE STATES] Error fetching live machine states:', error);
        return [];
    }
}

// Helper to extract all report data for a job (and program, line, etc.)
async function extractJobReportData({ job, program, line, machineIds, bottleneckMachine, Recipie, sequelize, QueryTypes, getTagValuesDifference, TagRefs, Tags, TagValues, Op, formatAlarms, prepareParetoData, prepareWaterfallData, calculateEmsMetrics, calculateManHourMetrics, Meters, Unit, Generator, GeneratorMeter, TariffUsage, Tariff, Sku, volumeOfDiesel, manHours, Location, TariffType, Settings, isLiveMode = false }) {
    // Check application resource type (defaults to 'FourO' for backward compatibility)
    const appResource = process.env.APP_RESOURCE || 'FourO';
    const isRIM = appResource === 'RIM';

    // Tag value diffs - For bc, csct, pltsct, bp, lost tags, use program dates
    console.log(`\n[REPORT] extractJobReportData - Job ID: ${job.id}, Program ID: ${program.id}`);
    console.log(`  Job Dates: ${job.actualStartTime} to ${job.actualEndTime}`);
    console.log(`  Program Dates: ${program.startDate} to ${program.endDate}`);
    
    // For live reports (running jobs), use NOW() as effective end time
    // For completed reports, use actualEndTime (existing behavior)
    const effectiveEndTime = isLiveMode ? new Date() : job.actualEndTime;
    
    if (isLiveMode) {
        console.log(`[LIVE REPORT] Using NOW() as effective end time: ${effectiveEndTime}`);
        console.log(`[LIVE REPORT] Job is currently running (actualEndTime is NULL)`);
    }

    // For live jobs job.skuId is NULL until the job closes.
    // Resolve the effective SKU now using the same logic as handleRecipeAssignment
    // so that numberOfContainersPerPack, recipe name, and EMS all work correctly.
    let effectiveSkuId = job.skuId;
    if (isLiveMode && !effectiveSkuId) {
        try {
            console.log(`\n[LIVE SKU] job.skuId is NULL — resolving effectiveSkuId from rcpn tag`);
            const rcpnTag = await Tags.findOne({
                where: { taggableId: line.id, taggableType: 'line', ref: TagRefs.RECIPE },
                raw: true
            });
            if (rcpnTag) {
                console.log(`[LIVE SKU] Found rcpn tag: id=${rcpnTag.id}, name=${rcpnTag.name}`);
                const latestRcpn = await TagValues.findOne({
                    where: { tagId: rcpnTag.id },
                    order: [['createdAt', 'DESC']],
                    attributes: ['value', 'createdAt'],
                    raw: true
                });
                if (latestRcpn?.value) {
                    const recipeNumber = parseInt(latestRcpn.value);
                    console.log(`[LIVE SKU] rcpn tag value: "${latestRcpn.value}" → recipeNumber=${recipeNumber}`);
                    const [recipeRow] = await sequelize.query(
                        `SELECT r.id, r.skuId 
                         FROM recipes r
                         JOIN linerecipies lr ON r.id = lr.recipieId
                         WHERE r.number = :recipeNumber 
                         AND lr.lineId = :lineId 
                         LIMIT 1`,
                        { replacements: { recipeNumber, lineId: line.id }, type: QueryTypes.SELECT }
                    );
                    if (recipeRow?.skuId) {
                        effectiveSkuId = recipeRow.skuId;
                        console.log(`[LIVE SKU] ✅ effectiveSkuId resolved: ${effectiveSkuId} (from recipe id=${recipeRow.id})`);
                    } else {
                        console.log(`[LIVE SKU] ⚠️  No recipe found in linerecipies for recipeNumber=${recipeNumber}, lineId=${line.id}`);
                    }
                } else {
                    console.log(`[LIVE SKU] ⚠️  rcpn tag has no values yet`);
                }
            } else {
                console.log(`[LIVE SKU] ⚠️  No rcpn tag found for line ${line.id} (${line.name})`);
            }
        } catch (err) {
            console.error('[LIVE SKU] ❌ Error resolving effectiveSkuId:', err);
        }
        console.log(`[LIVE SKU] Final effectiveSkuId: ${effectiveSkuId ?? 'null'}\n`);
    }

    // FIX: For live reports, use Job dates consistently (don't override with program dates)
    // For historical reports, keep existing behavior (use program dates)
    const programForTags = isLiveMode ? null : program;
    
    const fillerCount = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.BLOWERINPUT, job.actualStartTime, effectiveEndTime, programForTags, isLiveMode);
    console.log(`[REPORT] In Feed Counter (bc1): ${fillerCount}`);
    
    const fillerCountAqua = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.BLOWERINPUT, job.actualStartTime, effectiveEndTime, programForTags, isLiveMode);

    console.log(`[REPORT] FillerAqua Count (bc): ${fillerCountAqua}`);

    let bottlesLost = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.REJECTED_BOTTLES, job.actualStartTime, effectiveEndTime, programForTags, isLiveMode);
    console.log(`[REPORT] Bottles Lost (lost): ${bottlesLost}`);
    
    const palletsCount = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.PALLET_COUNT, job.actualStartTime, effectiveEndTime, programForTags, isLiveMode);
    console.log(`[REPORT] Pallets Count (pltsct): ${palletsCount}`);

    // Get SKU configuration for production calculation
    let numberOfContainersPerPack = 1;
    if (effectiveSkuId) {
        const sku = await Sku.findByPk(effectiveSkuId);
        if (sku && sku.numberOfContainersPerPack) {
            numberOfContainersPerPack = sku.numberOfContainersPerPack;
            console.log(`[REPORT] numberOfContainersPerPack=${numberOfContainersPerPack} (skuId=${effectiveSkuId})`);
        }
    }

    // Calculate net production using smart fallback
    // Krones: Only tries fillerout (no fallbacks)
    // Other lines: Tries fillerout → csct → bc
    const productionResult = await getProductionCountWithFallback(
        { Tags, TagValues, Op, Line }, 
        line.id, 
        job.actualStartTime, 
        effectiveEndTime,
        numberOfContainersPerPack,
        programForTags,  // null for live, program for historical
        isLiveMode
    );
    
    const netProduction = productionResult.bottleCount;
    const casesCount = productionResult.casesCount || 0;

    console.log(`[REPORT] Net Production: ${netProduction} bottles`);
    console.log(`[REPORT] Cases Count: ${casesCount} cases`);
    console.log(`[REPORT] Method used: ${productionResult.method} (${productionResult.source})`);

    if (isRIM) {
        bottlesLost = fillerCount - netProduction;
    } else {
        const lineName = line.name || '';
        const lineNameLower = lineName.toLowerCase();
        
        if (lineNameLower.includes('krones')) {
            bottlesLost = fillerCountAqua - netProduction;
        }
        // Ensure bottlesLost is a valid number (handle NaN or null cases)
        if (isNaN(bottlesLost) || bottlesLost === null || bottlesLost === undefined) {
            console.warn(`[REPORT] ⚠️  Invalid bottlesLost value detected: ${bottlesLost}, setting to 0`);
            bottlesLost = 0;
        }
    }
    
  

    // Alarms - Different logic for live vs historical reports
    let alarms = [];
    
    if (isLiveMode) {
        // LIVE MODE: Query TagValues directly for real-time alarm data
        console.log('[LIVE REPORT] Fetching live alarms from TagValues...');
        alarms = await getLiveAlarms({ 
            job, 
            machineIds, 
            sequelize, 
            QueryTypes, 
            Tags, 
            TagValues, 
            Op, 
            Machine,
            Alarm,
            generateAlarmJoinCondition 
        });
        console.log(`[LIVE REPORT] Found ${alarms.length} live alarms`);
    } else {
        // HISTORICAL MODE: Query AlarmAggregations (existing behavior)
        console.log('[HISTORICAL REPORT] Fetching alarms from AlarmAggregations...');
        const alarmsQuery = `
            SELECT 
                aa.id,
                aa.jobId,
                aa.machineId,
                aa.machineName,
                aa.alarmCode,
                aa.alarmStartDateTime,
                aa.alarmEndDateTime,
                aa.duration,
                aa.alarmReasonName,
                aa.alarmNote,
                m.name as machine_name,
                a.description as alarm_description
            FROM AlarmAggregations aa
            LEFT JOIN Machines m ON aa.machineId = m.id
            LEFT JOIN Alarms a ON (${generateAlarmJoinCondition('aa', 'a')})
            WHERE aa.jobId = :jobId
                AND aa.machineId IN (:machineIds)
                AND aa.duration >= 5
            ORDER BY aa.alarmStartDateTime ASC
        `;
        alarms = await sequelize.query(alarmsQuery, {
            replacements: {
                jobId: job.id,
                machineIds: machineIds
            },
            type: QueryTypes.SELECT,
        });
        console.log(`[HISTORICAL REPORT] Found ${alarms.length} historical alarms`);
    }
    
    const formattedAlarms = formatAlarms(alarms);

    // Metrics
    const { calculateMetrics, calculateTrueEfficiency, calculateVOTProgram } = require("./Kpis.controller.js");
    let metrics = {};
    let metricsTrueEff = { valueOperatingTime: 0, programDuration: 0, trueEfficiency: 0, isEstimated: false };
    try {
        const bottleneckMachineId = bottleneckMachine ? bottleneckMachine.id : machineIds[0];
        // Pass netProduction to calculateMetrics so VOT uses netProduction instead of fillerCounter
        metrics = await calculateMetrics(job.id, bottleneckMachineId, line.id, netProduction);
        
        // Only calculate true efficiency for completed jobs (not live reports)
        // For live reports, program.endDate is NULL, which causes calculateTrueEfficiency to throw an error
        if (!isLiveMode && program.endDate) {
            // HISTORICAL: Use actual program dates
            // Pass netProduction to calculateTrueEfficiency so VOT uses netProduction instead of fillerCounter
            metricsTrueEff = await calculateTrueEfficiency(program.id, job.id, line.id, null, netProduction);
            metrics = { ...metrics, ...metricsTrueEff };
        } else if (isLiveMode) {
            // LIVE: Calculate estimated true efficiency
            // Use calculateVOTProgram() to match historical calculation method (consistency)
            // Key difference from Net Efficiency: True Efficiency uses Program Duration (planned time), not Job Duration (actual time)
            console.log('[LIVE REPORT] Calculating estimated True Efficiency');
            
            try {
                const jobStartLive = liveInstantFromDbDate(job.actualStartTime) || dayjs(job.actualStartTime);
                const programStartLive = liveInstantFromDbDate(program.startDate) || dayjs(program.startDate);
                // Calculate current production time from job start to NOW (for live reports)
                const productionTime = dayjs(new Date()).diff(jobStartLive, 'minute');
                
                // Use calculateVOTProgram() to match historical True Efficiency calculation
                // Note: ProgramDuration parameter is passed but not used in calculation (same as historical)
                const votProgram = await calculateVOTProgram(job.id, line.id, productionTime, netProduction);
                
                // Calculate program duration from program start to NOW
                // Only use program data, not job data
                const programDuration = dayjs(new Date()).diff(programStartLive, 'minute');
                
                // True Efficiency = (VOT / Program Duration) * 100
                // Net Efficiency = (VOT / Job Duration) * 100
                // The difference: True Efficiency uses planned program time, Net Efficiency uses actual job time
                const trueEfficiency = programDuration > 0 
                    ? parseFloat(((votProgram / programDuration) * 100).toFixed(2)) 
                    : 0;
                
                metricsTrueEff = {
                    valueOperatingTime: votProgram,
                    programDuration: programDuration,
                    trueEfficiency: trueEfficiency,
                    isEstimated: true // Flag to indicate this is estimated
                };
                
                // Calculate job duration for comparison (actualStartTime to NOW for live reports)
                const jobDuration = dayjs(new Date()).diff(jobStartLive, 'minute');
                console.log(`[LIVE REPORT] Estimated True Efficiency: ${trueEfficiency}% (VOT: ${votProgram}, Program Duration: ${programDuration} min, Job Duration: ${jobDuration} min)`);
                console.log(`[LIVE REPORT] Using calculateVOTProgram() to match historical calculation method`);
                console.log(`[LIVE REPORT] Net Efficiency uses Job Duration, True Efficiency uses Program Duration`);
                
                metrics = { ...metrics, ...metricsTrueEff };
            } catch (trueEffError) {
                console.error('[LIVE REPORT] Error calculating estimated True Efficiency:', trueEffError);
                // Fall back to using metrics.vot if calculateVOTProgram fails
                console.warn('[LIVE REPORT] Falling back to metrics.vot from calculateMetrics()');
                const votProgram = metrics.vot || 0;
                const programStartLiveFb = liveInstantFromDbDate(program.startDate) || dayjs(program.startDate);
                const programDuration = dayjs(new Date()).diff(programStartLiveFb, 'minute');
                const trueEfficiency = programDuration > 0 
                    ? parseFloat(((votProgram / programDuration) * 100).toFixed(2)) 
                    : 0;
                
                metricsTrueEff = { 
                    valueOperatingTime: votProgram, 
                    programDuration: programDuration, 
                    trueEfficiency: trueEfficiency, 
                    isEstimated: true 
                };
                metrics = { ...metrics, ...metricsTrueEff };
            }
        } else {
            // No program start date available (shouldn't happen for live mode, but handle gracefully)
            console.log('[LIVE REPORT] Cannot calculate True Efficiency (not in live mode or missing data)');
            metrics = { ...metrics, ...metricsTrueEff };
        }
    } catch (error) {
        console.error('[REPORT] Error calculating metrics:', error);
        metrics = {
            vot: 0, ql: 0, not: 0, udt: 0, got: 0, slt: 0, sl: 0, batchDuration: 0,
            valueOperatingTime: 0, programDuration: 0, trueEfficiency: 0, isEstimated: false,
        };
    }
    
    // Calculate duration using effectiveEndTime (NOW() for live, actualEndTime for completed)
    const durationStart = isLiveMode
        ? (liveInstantFromDbDate(job.actualStartTime) || dayjs(job.actualStartTime))
        : dayjs(job.actualStartTime);
    const duration = dayjs(effectiveEndTime).diff(durationStart, "minute");
    
    if (isLiveMode) {
        console.log(`[LIVE REPORT] Duration calculated: ${duration} minutes (from start to NOW)`);
    }

    // Pareto (sunburst) - Different logic for live vs historical reports
    const bottleneckMachineId = bottleneckMachine ? bottleneckMachine.id : machineIds[0];
    let statesResults = [];

    if (isLiveMode) {
        // LIVE MODE: Calculate states from TagValues in real-time
        console.log('[LIVE REPORT] Fetching live machine states from TagValues...');
        statesResults = await getLiveMachineStates({ 
            job, 
            machineId: bottleneckMachineId,
            sequelize, 
            QueryTypes, 
            Tags, 
            TagValues, 
            Op 
        });
        console.log(`[LIVE REPORT] Found ${statesResults.length} machine states`);
    } else {
        // HISTORICAL MODE: Query MachineStateAggregations (existing behavior)
        console.log('[HISTORICAL REPORT] Fetching machine states from MachineStateAggregations...');
        const statesQuery = `
            SELECT 
            MSA.stateCode,
            MSA.stateName,
            SUM(MSA.duration) as total_duration
            FROM 
            MachineStateAggregations MSA
            WHERE 
            MSA.jobId = :jobId
            AND MSA.machineId = :bottleneckMachineId
            GROUP BY 
            MSA.stateCode,
            MSA.stateName
            ORDER BY 
            total_duration DESC
        `;
        statesResults = await sequelize.query(statesQuery, {
            replacements: {
                jobId: job.id,
                bottleneckMachineId: bottleneckMachineId
            },
            type: QueryTypes.SELECT,
        });
        console.log(`[HISTORICAL REPORT] Found ${statesResults.length} machine states`);
    }
    
    const paretoData = prepareParetoData(statesResults);

    // Waterfall
    const waterfallData = prepareWaterfallData(program, job, metrics, isLiveMode);

    // Recipe — uses effectiveSkuId (works for both historical and live)
    let recipe = null;
    if (effectiveSkuId) {
        recipe = await Recipie.findOne({ where: { skuId: effectiveSkuId } });
        console.log(`[REPORT] Recipe lookup for skuId=${effectiveSkuId}: ${recipe ? `"${recipe.name}"` : 'not found'}`);
    }

    // EMS Calculations
    // Ensure volumeOfDiesel is a number (could be string from DB or API)
    const volumeOfDieselNum = parseFloat(volumeOfDiesel) || 0;
    let emsMetrics = {
        totalKwh: 0,
        kwhPer8OzCase: 0,
        kwhPerPack: 0,
        volumeOfDiesel: volumeOfDieselNum,
        costOfKwhPerDiesel: 0,
        pricePerLiter: 0,
        totalLiters: 0
    };

    try {
        const sku = effectiveSkuId ? await Sku.findByPk(effectiveSkuId) : null;
        const emsDeps = {
            Tags, TagValues, Op, Meters, Unit, Generator, GeneratorMeter, 
            TariffUsage, Tariff, sequelize, QueryTypes, Line, Location
        };
        emsMetrics = await calculateEmsMetrics(
            emsDeps,
            job,
            program,
            line,
            sku,
            netProduction,
            casesCount,
            volumeOfDieselNum
        );
    } catch (error) {
        console.error('Error calculating EMS metrics:', error);
    }

    // Calculate Man Hour Metrics
    let manHourMetrics = {
        casePerManHour: 'N/A',
        costPerManHour: 'N/A',
        costPerManHourValue: 0,
        costPerCase: 'N/A',
        manHours: 0
    };

    try {
        const manHourDeps = {
            Settings, Line
        };
        manHourMetrics = await calculateManHourMetrics(
            manHourDeps,
            job,
            line,
            casesCount,
            manHours || 0
        );
    } catch (error) {
        console.error('Error calculating Man Hour metrics:', error);
    }

    return {
        fillerCount,
        netProduction,
        bottlesLost,
        casesCount,
        palletsCount,
        formattedAlarms,
        metrics,
        duration,
        paretoData,
        waterfallData,
        recipe,
        job,
        program,
        statesResults,
        emsMetrics,
        manHourMetrics
    };
}

module.exports = {
    createReport: async (req, res) => {
        const transaction = await sequelize.transaction();
        try {
            const maxSortOrder = await Report.max("sortOrder", { transaction });
            const report = await Report.create(
                {
                    ...req.body,
                    sortOrder: isNaN(maxSortOrder) ? 0 : maxSortOrder + 1,
                },
                { transaction }
            );
            await transaction.commit();
            res.status(201).json(report);
        } catch (error) {
            await transaction.rollback();
            console.error("Error creating report:", error);
            res.status(500).json({ error: error.message });
        }
    },

    getReportsByUserId: async (req, res) => {
        try {
            const { userId } = req.params;
            const userOrders = await UserReportOrder.findAll({
                where: { userId },
                order: [["sortOrder", "ASC"]],
            });
            const orderedReportIds = userOrders.map(order => order.reportId);
            let reports = [];
            if (orderedReportIds.length > 0) {
                reports = await Report.findAll({
                    where: { id: orderedReportIds },
                    order: [
                        [sequelize.literal(`FIELD(id, ${orderedReportIds.join(",")})`)]
                    ]
                });
            } else {
                reports = await Report.findAll({ where: { userId } });
            }
            res.status(200).json(Array.isArray(reports) ? reports : []);
        } catch (error) {
            console.error("Error in getReportsByUserId:", error);
            res.status(500).json({ error: error.message });
        }
    },

    getAllReports: async (req, res) => {
        try {
            const reports = await Report.findAll({
                order: [["sortOrder", "ASC"]],
            });
            res.status(200).json(reports);
        } catch (error) {
            console.error("Error fetching all reports:", error);
            res.status(500).json({ error: error.message });
        }
    },

    getReportById: async (req, res) => {
        try {
            const report = await Report.findByPk(req.params.id);
            if (!report) {
                return res.status(404).json({ message: "Report not found" });
            }
            res.status(200).json(report);
        } catch (error) {
            console.error("Error fetching report:", error);
            res.status(500).json({ error: error.message });
        }
    },

    updateReport: async (req, res) => {
        try {
            const [updated] = await Report.update(req.body, {
                where: { id: req.params.id },
            });
            if (!updated) {
                return res.status(404).json({ message: "Report not found" });
            }
            const updatedReport = await Report.findByPk(req.params.id);
            res.status(200).json(updatedReport);
        } catch (error) {
            console.error("Error updating report:", error);
            res.status(500).json({ error: error.message });
        }
    },

    // NEW: Toggle favorite status
    toggleReportFavorite: async (req, res) => {
        const transaction = await sequelize.transaction();
        try {
            const { id } = req.params;
            const report = await Report.findByPk(id, { transaction });
            
            if (!report) {
                await transaction.rollback();
                return res.status(404).json({ message: "Report not found" });
            }

            // Toggle the favorite status
            const newFavoriteStatus = !report.isFavorite;
            await Report.update(
                { isFavorite: newFavoriteStatus },
                { where: { id }, transaction }
            );

            await transaction.commit();
            
            const updatedReport = await Report.findByPk(id);
            res.status(200).json({
                message: `Report ${newFavoriteStatus ? 'added to' : 'removed from'} favorites`,
                report: updatedReport,
                isFavorite: newFavoriteStatus
            });
        } catch (error) {
            await transaction.rollback();
            console.error("Error toggling report favorite:", error);
            res.status(500).json({ error: error.message });
        }
    },

    // NEW: Get favorite reports
    getFavoriteReports: async (req, res) => {
        try {
            const reports = await Report.findAll({
                where: { isFavorite: true },
                order: [["sortOrder", "ASC"]],
            });
            res.status(200).json(reports);
        } catch (error) {
            console.error("Error fetching favorite reports:", error);
            res.status(500).json({ error: error.message });
        }
    },

    reorderReports: async (req, res) => {
        const transaction = await sequelize.transaction();
        try {
            const { reports } = req.body;
            for (const { reportId, sortOrder } of reports) {
                await Report.update({ sortOrder }, {
                    where: { id: reportId },
                    transaction,
                });
            }
            await transaction.commit();
            res.status(200).json({ message: "Report sort order updated successfully." });
        } catch (error) {
            await transaction.rollback();
            console.error("Error updating report order:", error);
            res.status(500).json({ error: error.message });
        }
    },

    deleteReport: async (req, res) => {
        try {
            const deleted = await Report.destroy({
                where: { id: req.params.id },
            });
            if (!deleted) {
                return res.status(404).json({ message: "Report not found" });
            }
            res.status(200).json({ message: "Report deleted successfully" });
        } catch (error) {
            console.error("Error deleting report:", error);
            res.status(500).json({ error: error.message });
        }
    },

    getAvailableSkus: async (req, res) => {
        try {
            const { id } = req.params;
            const report = await Report.findByPk(id);
            if (!report) {
                return res.status(404).json({ message: "Report not found" });
            }
            const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config;

            // Only provide SKUs for non-job-based reports
            const isQuick = config.wtd || config.mtd || config.ytd || config.dr;
            if (!isQuick) {
                return res.status(400).json({ message: "SKU filter is only available for date range reports" });
            }

            let startDate, endDate;
            const referenceDate = dayjs(report.createdAt);
            if (config.wtd) {
                startDate = referenceDate.startOf('week').toDate();
                endDate = referenceDate.endOf('day').toDate();
            } else if (config.mtd) {
                startDate = referenceDate.startOf('month').toDate();
                endDate = referenceDate.endOf('day').toDate();
            } else if (config.ytd) {
                startDate = referenceDate.startOf('year').toDate();
                endDate = referenceDate.endOf('day').toDate();
            } else if (config.dr) {
                startDate = dayjs(config.startDate).startOf('day').toDate();
                endDate = dayjs(config.endDate).endOf('day').toDate();
            }

            // Fetch all jobs in range to get available SKUs
            const jobs = await Job.findAll({
                where: {
                    lineId: config.selectedLineId,
                    actualStartTime: { [Op.gte]: startDate },
                    actualEndTime: { [Op.lte]: endDate }
                },
                attributes: ['skuId'],
                group: ['skuId'],
                raw: true
            });

            // Get unique SKUs and their recipe names
            const skuIds = jobs.map(job => job.skuId).filter(skuId => skuId);
            const recipes = await Recipie.findAll({
                where: { skuId: { [Op.in]: skuIds } },
                attributes: ['skuId', 'name'],
                raw: true
            });

            const availableSkus = skuIds.map(skuId => {
                const recipe = recipes.find(r => r.skuId === skuId);
                return {
                    id: skuId,
                    name: recipe?.name || `SKU ${skuId}`
                };
            });

            res.status(200).json({ availableSkus });
        } catch (error) {
            console.error("Error fetching available SKUs:", error);
            res.status(500).json({ error: error.message });
        }
    },

    getReportData: async (req, res) => {
        try {
            const { id } = req.params;
            const { skuFilter } = req.query; // Add SKU filter parameter
            const report = await Report.findByPk(id);
            if (!report) {
                return res.status(404).json({ message: "Report not found" });
            }
            const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config;

            // Detect quick filter
            const isQuick = config.wtd || config.mtd || config.ytd || config.dr;
            let startDate, endDate;
            if (isQuick) {
                const referenceDate = dayjs(report.createdAt);
                if (config.wtd) {
                    startDate = referenceDate.startOf('week').toDate();
                    endDate = referenceDate.endOf('day').toDate();
                } else if (config.mtd) {
                    startDate = referenceDate.startOf('month').toDate();
                    endDate = referenceDate.endOf('day').toDate();
                } else if (config.ytd) {
                    startDate = referenceDate.startOf('year').toDate();
                    endDate = referenceDate.endOf('day').toDate();
                } else if (config.dr) {
                    startDate = dayjs(config.startDate).startOf('day').toDate();
                    endDate = dayjs(config.endDate).endOf('day').toDate();
                }

                // Fetch line and machines
                const line = await Line.findByPk(config.selectedLineId, {
                    attributes: ["id", "name"],
                    include: [
                        { model: Machine, as: "machines", attributes: ["id", "name"] },
                        { model: Machine, as: "bottleneckMachine", attributes: ["id", "name"] }
                    ],
                });
                if (!line) return res.status(404).json({ message: "Line not found" });
                const machineIds = line.machines.map(machine => machine.id);

                // Fetch all jobs in range
                const jobsWhereClause = {
                    lineId: config.selectedLineId,
                    actualStartTime: { [Op.gte]: startDate },
                    actualEndTime: { [Op.lte]: endDate }
                };
                
                // Add SKU filter if provided
                if (skuFilter) {
                    jobsWhereClause.skuId = skuFilter;
                }
                
                const jobs = await Job.findAll({
                    where: jobsWhereClause
                });
                if (!jobs.length) {
                    const errorMessage = skuFilter 
                        ? `No jobs found for the selected SKU (${skuFilter}) in the specified range`
                        : "No jobs found in selected range";
                    return res.status(404).json({ message: errorMessage });
                }

                // Aggregate all jobs
                let totalFillerCount = 0, totalNetProduction = 0, totalBottlesLost = 0, totalCasesCount = 0, totalPalletsCount = 0;
                let allAlarms = [];
                let allMetrics = [];
                let allParetoStates = [];
                let allWaterfall = [];
                let totalDuration = 0;
                let allPrograms = [];
                let allRecipes = [];
                let bottleneckMachine = line.bottleneckMachine;
                let allStatesResults = [];
                let allEmsMetrics = [];
                let allManHourMetrics = [];
                // Ensure volumeOfDiesel is a number (could be string from DB)
                const volumeOfDiesel = parseFloat(report.volumeOfDiesel) || 0;
                const manHours = parseFloat(report.manHours) || 0;

                for (const job of jobs) {
                    const program = await Program.findByPk(job.programId);
                    allPrograms.push(program);
                    const manHours = report.manHours || 0;
                    const jobData = await extractJobReportData({ 
                        job, program, line, machineIds, bottleneckMachine, Recipie, sequelize, QueryTypes, 
                        getTagValuesDifference, TagRefs, Tags, TagValues, Op, formatAlarms, prepareParetoData, 
                        prepareWaterfallData, calculateEmsMetrics, calculateManHourMetrics, Meters, Unit, Generator, GeneratorMeter, 
                        TariffUsage, Tariff, Sku, volumeOfDiesel, manHours, Location, TariffType, Settings
                    });
                    totalFillerCount += jobData.fillerCount;
                    totalNetProduction += jobData.netProduction;
                    totalBottlesLost += jobData.bottlesLost;
                    totalCasesCount += jobData.casesCount;
                    totalPalletsCount += jobData.palletsCount;
                    allAlarms.push(...jobData.formattedAlarms);
                    allMetrics.push(jobData.metrics);
                    totalDuration += jobData.duration;
                    allStatesResults.push(...(jobData.statesResults || []));
                    allWaterfall.push({ program, job, metrics: jobData.metrics });
                    if (jobData.recipe) allRecipes.push(jobData.recipe);
                    if (jobData.emsMetrics) allEmsMetrics.push(jobData.emsMetrics);
                    if (jobData.manHourMetrics) allManHourMetrics.push(jobData.manHourMetrics);
                }

                // Add these helpers after the for-loop and before their first use
                const sumMetrics = (key) => allMetrics.reduce((sum, m) => sum + (parseFloat(m[key]) || 0), 0);

                const avgMetrics = (key) => allMetrics.length ? sumMetrics(key) / allMetrics.length : 0;
                

                // Aggregate pareto states by stateName and stateCode
                const paretoMap = {};
                for (const state of allStatesResults) {
                    const key = `${state.stateCode}__${state.stateName}`;
                    if (!paretoMap[key]) {
                        paretoMap[key] = { ...state, total_duration: 0 };
                    }
                    paretoMap[key].total_duration = parseFloat(paretoMap[key].total_duration) + parseFloat(state.total_duration);
                }
                const paretoData = prepareParetoData(Object.values(paretoMap));

                // Waterfall: aggregate by summing durations
                const firstWaterfall = allWaterfall[0];
                const aggWaterfall = {
                    labels: firstWaterfall ? prepareWaterfallData(firstWaterfall.program, firstWaterfall.job, firstWaterfall.metrics).labels : [],
                    values: []
                };
                if (firstWaterfall) {
                    const labelCount = aggWaterfall.labels.length;
                    for (let i = 0; i < labelCount; i++) {
                        let sum = 0;
                        for (const wf of allWaterfall) {
                            const wfData = prepareWaterfallData(wf.program, wf.job, wf.metrics);
                            sum += parseFloat(wfData.values[i]) || 0;
                        }
                        aggWaterfall.values.push(sum);
                    }
                }

                // KPIs - Merge overlapping breakdowns to avoid double counting for calculations
                const mergedBreakdowns = mergeOverlappingBreakdowns(allAlarms);
                const numberOfBreakdowns = mergedBreakdowns.length;
                const totalDowntime = mergedBreakdowns.reduce((total, breakdown) => {
                    const breakdownDuration = dayjs(breakdown.endDateTime).diff(dayjs(breakdown.startDateTime), 'minute');
                    return total + breakdownDuration;
                }, 0);
                const alarmsAboveFiveMinutes = allAlarms.filter(alarm => parseFloat(alarm.duration) >= 5);
                const totalAlarmsDowntime = alarmsAboveFiveMinutes.reduce((total, alarm) => total + parseFloat(alarm.duration), 0);
                const mechanicalDowntime = totalAlarmsDowntime;
                const mechanicalAvailability = (totalDuration / (totalDuration + mechanicalDowntime)) * 100;
                const mtbf = numberOfBreakdowns > 0 ? totalDuration / numberOfBreakdowns : 0;
                const mttr = numberOfBreakdowns > 0 ? totalDowntime / numberOfBreakdowns : 0;
                const availability = sumMetrics('got') && sumMetrics('batchDuration') ? (sumMetrics('got') / sumMetrics('batchDuration')) * 100 : 0;
                const performance = sumMetrics('not') && sumMetrics('got') ? (sumMetrics('not') / sumMetrics('got')) * 100 : 0;
                const oee = sumMetrics('vot') && totalDuration ? (sumMetrics('vot') / totalDuration) * 100 : 0;

                // General info: use first/last job/program for times
                const sortedJobs = jobs.sort((a, b) => new Date(a.actualStartTime) - new Date(b.actualStartTime));
                const firstJob = sortedJobs[0];
                const lastJob = sortedJobs[sortedJobs.length - 1];
                const firstProgram = allPrograms[0];
                const lastProgram = allPrograms[allPrograms.length - 1];
                const recipe = allRecipes[0];

                // Calculate program duration (from first program start to last program end, in minutes)
                let programDuration = null;
                if (firstProgram?.startDate && lastProgram?.endDate) {
                    const programStart = dayjs(firstProgram.startDate);
                    const programEnd = dayjs(lastProgram.endDate);
                    if (programStart.isValid() && programEnd.isValid()) {
                        programDuration = Math.max(0, programEnd.diff(programStart, 'minute'));
                    }
                }

                // Aggregate EMS metrics
                // Ensure volumeOfDiesel is a number (could be string from DB or API)
                const volumeOfDieselNum = parseFloat(volumeOfDiesel) || 0;
                
                const aggregatedEms = {
                    totalKwh: allEmsMetrics.reduce((sum, ems) => sum + (parseFloat(ems.totalKwh) || 0), 0),
                    kwhPer8OzCase: 0,
                    kwhPerPack: totalCasesCount > 0 
                        ? allEmsMetrics.reduce((sum, ems) => sum + (parseFloat(ems.totalKwh) || 0), 0) / totalCasesCount
                        : 0,
                    volumeOfDiesel: volumeOfDieselNum,
                    costOfKwhPerDiesel: 0,
                    pricePerLiter: allEmsMetrics.length > 0 
                        ? allEmsMetrics.reduce((sum, ems) => sum + (parseFloat(ems.pricePerLiter) || 0), 0) / allEmsMetrics.length
                        : 0,
                    totalLiters: allEmsMetrics.reduce((sum, ems) => sum + (parseFloat(ems.totalLiters) || 0), 0)
                };

                // Calculate kwhPer8OzCase for aggregated data
                const EIGHT_OZ_CASE_FACTOR = 5.678;
                aggregatedEms.kwhPer8OzCase = aggregatedEms.totalLiters > 0
                    ? aggregatedEms.totalKwh / (aggregatedEms.totalLiters / EIGHT_OZ_CASE_FACTOR)
                    : 0;

                // Calculate cost of kwh per diesel
                aggregatedEms.costOfKwhPerDiesel = aggregatedEms.pricePerLiter * volumeOfDieselNum;

                // Round values - ensure all values are numbers before calling toFixed
                aggregatedEms.totalKwh = parseFloat((parseFloat(aggregatedEms.totalKwh) || 0).toFixed(2));
                aggregatedEms.kwhPer8OzCase = parseFloat((parseFloat(aggregatedEms.kwhPer8OzCase) || 0).toFixed(4));
                aggregatedEms.kwhPerPack = parseFloat((parseFloat(aggregatedEms.kwhPerPack) || 0).toFixed(4));
                aggregatedEms.volumeOfDiesel = parseFloat((parseFloat(aggregatedEms.volumeOfDiesel) || 0).toFixed(2));
                aggregatedEms.costOfKwhPerDiesel = parseFloat((parseFloat(aggregatedEms.costOfKwhPerDiesel) || 0).toFixed(2));
                aggregatedEms.pricePerLiter = parseFloat((parseFloat(aggregatedEms.pricePerLiter) || 0).toFixed(2));
                aggregatedEms.totalLiters = parseFloat((parseFloat(aggregatedEms.totalLiters) || 0).toFixed(2));

                // Aggregate Man Hour metrics
                const aggregatedManHour = {
                    casePerManHour: manHours > 0 && totalCasesCount > 0
                        ? parseFloat((totalCasesCount / manHours).toFixed(2))
                        : 'N/A',
                    costPerManHour: 'N/A',
                    costPerManHourValue: allManHourMetrics.length > 0
                        ? allManHourMetrics.reduce((sum, mh) => sum + (parseFloat(mh.costPerManHourValue) || 0), 0) / allManHourMetrics.length
                        : 0,
                    costPerCase: 'N/A',
                    manHours: manHours || 0
                };

                // Calculate cost per man hour if we have valid values
                if (manHours > 0 && aggregatedManHour.costPerManHourValue > 0) {
                    aggregatedManHour.costPerManHour = parseFloat((manHours * aggregatedManHour.costPerManHourValue).toFixed(2));
                    
                    // Calculate cost per case
                    if (totalCasesCount > 0 && aggregatedManHour.costPerManHour > 0) {
                        aggregatedManHour.costPerCase = parseFloat((aggregatedManHour.costPerManHour / totalCasesCount).toFixed(4));
                    }
                }

                // Round values
                if (typeof aggregatedManHour.costPerManHourValue === 'number') {
                    aggregatedManHour.costPerManHourValue = parseFloat(aggregatedManHour.costPerManHourValue.toFixed(2));
                }
                if (typeof aggregatedManHour.costPerManHour === 'number') {
                    aggregatedManHour.costPerManHour = parseFloat(aggregatedManHour.costPerManHour.toFixed(2));
                }

                // Prepare production run batches data
                const productionRunBatches = jobs.map(job => {
                    const jobProgram = allPrograms.find(p => p.id === job.programId);
                    const jobRecipe = allRecipes.find(r => r.skuId === job.skuId);
                    const jobDuration = dayjs(job.actualEndTime).diff(dayjs(job.actualStartTime), "minute");
                    
                    return {
                        id: job.id,
                        jobName: job.jobName,
                        programName: jobProgram?.programName || "N/A",
                        startTime: job.actualStartTime ? dayjs(job.actualStartTime).utc().format('DD/MM/YYYY HH:mm') : null,
                        endTime: job.actualEndTime ? dayjs(job.actualEndTime).utc().format('DD/MM/YYYY HH:mm') : null,
                        duration: jobDuration,
                        recipeName: jobRecipe?.name || "N/A",
                        skuId: job.skuId,
                        programId: job.programId,
                        lineId: job.lineId,
                        // Note: Individual job production metrics would need to be calculated separately
                        // For now, we'll include basic job info and let frontend handle detailed metrics if needed
                    };
                });

                res.status(200).json({
                    reportName: report.name,
                    general: {
                        lineName: line.name,
                        jobName: `${firstJob.jobName} - ${lastJob.jobName}`,
                        startTime: firstJob?.actualStartTime ? dayjs(firstJob.actualStartTime).utc().format('DD/MM/YYYY HH:mm') : null,
                        endTime: lastJob?.actualEndTime ? dayjs(lastJob.actualEndTime).utc().format('DD/MM/YYYY HH:mm') : null,
                        duration: totalDuration,
                        programName: firstProgram?.programName || "N/A",
                        recipeName: recipe?.name || "N/A",
                        startupTime: firstProgram?.startDate ? dayjs(firstProgram.startDate).utc().format('DD/MM/YYYY HH:mm') : null,
                        runoutTime: lastProgram?.endDate ? dayjs(lastProgram.endDate).utc().format('DD/MM/YYYY HH:mm') : null,
                        programDuration: programDuration,
                        bottleneckStartTime: firstJob?.actualStartTime ? dayjs(firstJob.actualStartTime).utc().format('DD/MM/YYYY HH:mm') : null,
                        bottleneckEndTime: lastJob?.actualEndTime ? dayjs(lastJob.actualEndTime).utc().format('DD/MM/YYYY HH:mm') : null,
                        bottleneckName: bottleneckMachine?.name || "N/A",
                    },
                    production: {
                        netProduction: totalNetProduction,
                        fillerCounter: totalFillerCount,
                        packerCounter: totalCasesCount,
                        palCounter: totalPalletsCount,
                        bottlesLost: totalBottlesLost
                    },
                    kpis: {
                        availability: availability.toFixed(2),
                        performance: performance.toFixed(2),
                        oee: oee.toFixed(2),
                        mtbf: mtbf.toFixed(2),
                        mttr: mttr.toFixed(2),
                        metrics: {
                            vot: sumMetrics('vot'),
                            ql: sumMetrics('ql'),
                            not: sumMetrics('not'),
                            udt: sumMetrics('udt'),
                            got: sumMetrics('got'),
                            slt: sumMetrics('slt'),
                            sl: sumMetrics('sl'),
                            batchDuration: sumMetrics('batchDuration'),
                            valueOperatingTime: sumMetrics('valueOperatingTime'),
                            programDuration: sumMetrics('programDuration'),
                            trueEfficiency: sumMetrics('programDuration') > 0 
                                ? parseFloat(((sumMetrics('valueOperatingTime') / sumMetrics('programDuration')) * 100).toFixed(2))
                                : 0,
                        },
                        mechanicalAvailability: mechanicalAvailability.toFixed(2),
                    },
                    paretoData: [paretoData],
                    waterfallData: aggWaterfall,
                    alarms: allAlarms,
                    line: line,
                    jobs: jobs,
                    machines: line.machines,
                    productionRunBatches: productionRunBatches,
                    ems: aggregatedEms,
                    manHourMetrics: aggregatedManHour,
                });
                return;
            }

            // --- Original single-job logic below ---
            const program = await Program.findByPk(config.selectedJobId);
            const job = await Job.findOne({ where: { programId: program.id } });
            const line = await Line.findByPk(config.selectedLineId, {
                attributes: ["id", "name"],
                include: [
                    { model: Machine, as: "machines", attributes: ["id", "name"] },
                    { model: Machine, as: "bottleneckMachine", attributes: ["id", "name"] }
                ],
            });
            if (!line) {
                return res.status(404).json({ message: "Line not found" });
            }
            const machineIds = line.machines.map(machine => machine.id);
            const bottleneckMachine = line.bottleneckMachine;
            // Ensure volumeOfDiesel is a number (could be string from DB)
            const volumeOfDiesel = parseFloat(report.volumeOfDiesel) || 0;
            const manHours = parseFloat(report.manHours) || 0;
            const jobData = await extractJobReportData({ 
                job, program, line, machineIds, bottleneckMachine, Recipie, sequelize, QueryTypes, 
                getTagValuesDifference, TagRefs, Tags, TagValues, Op, formatAlarms, prepareParetoData, 
                prepareWaterfallData, calculateEmsMetrics, calculateManHourMetrics, Meters, Unit, Generator, GeneratorMeter, 
                TariffUsage, Tariff, Sku, volumeOfDiesel, manHours, Location, TariffType, Settings
            });

            // Calculate program duration (from program start to program end, in minutes)
            let programDuration = null;
            if (program?.startDate && program?.endDate) {
                const programStart = dayjs(program.startDate);
                const programEnd = dayjs(program.endDate);
                if (programStart.isValid() && programEnd.isValid()) {
                    programDuration = Math.max(0, programEnd.diff(programStart, 'minute'));
                }
            }

            // KPIs - Merge overlapping breakdowns to avoid double counting for calculations
            const mergedBreakdowns = mergeOverlappingBreakdowns(jobData.formattedAlarms);
            const numberOfBreakdowns = mergedBreakdowns.length;
            const totalDowntime = mergedBreakdowns.reduce((total, breakdown) => {
                const breakdownDuration = dayjs(breakdown.endDateTime).diff(dayjs(breakdown.startDateTime), 'minute');
                return total + breakdownDuration;
            }, 0);
            const alarmsAboveFiveMinutes = jobData.formattedAlarms.filter(alarm => parseFloat(alarm.duration) >= 5);
            const totalAlarmsDowntime = alarmsAboveFiveMinutes.reduce((total, alarm) => total + parseFloat(alarm.duration), 0);
            const mechanicalDowntime = totalAlarmsDowntime;
            const mechanicalAvailability = (jobData.duration / (jobData.duration + mechanicalDowntime)) * 100;
            const mtbf = numberOfBreakdowns > 0 ? jobData.duration / numberOfBreakdowns : 0;
            const mttr = numberOfBreakdowns > 0 ? totalDowntime / numberOfBreakdowns : 0;
            const availability = jobData.metrics.got && jobData.metrics.batchDuration ? (jobData.metrics.got / jobData.metrics.batchDuration) * 100 : 0;
            const performance = jobData.metrics.not && jobData.metrics.got ? (jobData.metrics.not / jobData.metrics.got) * 100 : 0;
            const oee = (jobData.metrics.vot / jobData.duration) * 100;
            const recipe = jobData.recipe;

            res.status(200).json({
                reportName: report.name,
                general: {
                    lineName: line.name,
                    jobName: job.jobName,
                    startTime: job?.actualStartTime ? dayjs(job.actualStartTime).utc().format('DD/MM/YYYY HH:mm') : null,
                    endTime: job?.actualEndTime ? dayjs(job.actualEndTime).utc().format('DD/MM/YYYY HH:mm') : null,
                    duration: jobData.duration,
                    programName: program.programName || "N/A",
                    recipeName: recipe?.name || "N/A",
                    startupTime: program?.startDate ? dayjs(program.startDate).utc().format('DD/MM/YYYY HH:mm') : null,
                    runoutTime: program?.endDate ? dayjs(program.endDate).utc().format('DD/MM/YYYY HH:mm') : null,
                    programDuration: programDuration,
                    bottleneckStartTime: job?.actualStartTime ? dayjs(job.actualStartTime).utc().format('DD/MM/YYYY HH:mm') : null,
                    bottleneckEndTime: job?.actualEndTime ? dayjs(job.actualEndTime).utc().format('DD/MM/YYYY HH:mm') : null,
                    bottleneckName: bottleneckMachine?.name || "N/A",
                },
                production: {
                    netProduction: jobData.netProduction,
                    fillerCounter: jobData.fillerCount,
                    packerCounter: jobData.casesCount,
                    palCounter: jobData.palletsCount,
                    bottlesLost: jobData.bottlesLost
                },
                kpis: {
                    availability: availability.toFixed(2),
                    performance: performance.toFixed(2),
                    oee: oee.toFixed(2),
                    mtbf: mtbf.toFixed(2),
                    mttr: mttr.toFixed(2),
                    metrics: jobData.metrics,
                    mechanicalAvailability: mechanicalAvailability.toFixed(2),
                },
                paretoData: [jobData.paretoData],
                waterfallData: jobData.waterfallData,
                alarms: jobData.formattedAlarms,
                line: line,
                job: job,
                machines: line.machines,
                ems: jobData.emsMetrics || {
                    totalKwh: 0,
                    kwhPer8OzCase: 0,
                    kwhPerPack: 0,
                    volumeOfDiesel: parseFloat(volumeOfDiesel) || 0,
                    costOfKwhPerDiesel: 0,
                    pricePerLiter: 0,
                    totalLiters: 0
                },
                manHourMetrics: jobData.manHourMetrics || {
                    casePerManHour: 'N/A',
                    costPerManHour: 'N/A',
                    costPerManHourValue: 0,
                    costPerCase: 'N/A',
                    manHours: manHours || 0
                },
            });
        } catch (error) {
            console.error("Error fetching report data:", error);
            res.status(500).json({ error: error.message });
        }
    },

    // NEW: Get live report data for running jobs (actualEndTime IS NULL)
    getLiveReportData: async (req, res) => {
        try {
            console.log('\n=== LIVE REPORT DATA REQUEST ===');
            console.log('Report ID:', req.params.id);
            
            const { id } = req.params;
            const report = await Report.findByPk(id);
            
            if (!report) {
                return res.status(404).json({ message: "Report not found" });
            }
            
            const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config;
            console.log('Config - selectedJobId:', config.selectedJobId);

            // This endpoint is only for single job-based reports
            if (!config.selectedJobId) {
                return res.status(400).json({ 
                    message: "Live report data is only available for job-based reports",
                    hint: "Use /reports/:id/data for date range reports"
                });
            }

            // Get the job
            const program = await Program.findByPk(config.selectedJobId);
            if (!program) {
                return res.status(404).json({ message: "Program not found" });
            }
            
            const job = await Job.findOne({ where: { programId: program.id } });
            if (!job) {
                return res.status(404).json({ message: "Job not found" });
            }

            // Check if job is actually running (actualEndTime should be NULL)
            if (job.actualEndTime !== null) {
                console.log('⚠️ WARNING: Job has ended. Redirecting to regular report endpoint.');
                console.log('Job actualEndTime:', job.actualEndTime);
                
                // Job completed - return regular report data with a flag
                // Frontend should detect this and stop polling
                return res.status(200).json({
                    message: "Job has completed. Use regular report endpoint.",
                    isLive: false,
                    jobCompleted: true,
                    redirectTo: `/reports/${id}/data`
                });
            }

            console.log('✅ Job is running - actualEndTime is NULL');
            console.log('Job actualStartTime:', job.actualStartTime);

            // Get line and machines
            const line = await Line.findByPk(config.selectedLineId, {
                attributes: ["id", "name"],
                include: [
                    { model: Machine, as: "machines", attributes: ["id", "name"] },
                    { model: Machine, as: "bottleneckMachine", attributes: ["id", "name"] }
                ],
            });
            
            if (!line) {
                return res.status(404).json({ message: "Line not found" });
            }
            
            const machineIds = line.machines.map(machine => machine.id);
            const bottleneckMachine = line.bottleneckMachine;
            
            // Ensure volumeOfDiesel and manHours are numbers
            const volumeOfDiesel = parseFloat(report.volumeOfDiesel) || 0;
            const manHours = parseFloat(report.manHours) || 0;

            // Extract job report data with LIVE MODE enabled
            console.log('🔴 Calling extractJobReportData with isLiveMode = true');
            const jobData = await extractJobReportData({ 
                job, 
                program, 
                line, 
                machineIds, 
                bottleneckMachine, 
                Recipie, 
                sequelize, 
                QueryTypes, 
                getTagValuesDifference, 
                TagRefs, 
                Tags, 
                TagValues, 
                Op, 
                formatAlarms, 
                prepareParetoData, 
                prepareWaterfallData, 
                calculateEmsMetrics, 
                calculateManHourMetrics, 
                Meters, 
                Unit, 
                Generator, 
                GeneratorMeter, 
                TariffUsage, 
                Tariff, 
                Sku, 
                volumeOfDiesel, 
                manHours, 
                Location, 
                TariffType, 
                Settings,
                isLiveMode: true  // ✅ Enable live mode
            });

            console.log('✅ Live report data extracted successfully');
            console.log('Duration:', jobData.duration, 'minutes');
            console.log('Net Production:', jobData.netProduction);

            // Calculate program duration (for running jobs, use start to NOW; wall-time aware for live)
            let programDuration = null;
            if (program?.startDate) {
                const programStart = liveInstantFromDbDate(program.startDate) || dayjs(program.startDate);
                const now = dayjs();
                if (programStart.isValid()) {
                    programDuration = Math.max(0, now.diff(programStart, 'minute'));
                }
            }

            // KPIs - Merge overlapping breakdowns to avoid double counting
            const mergedBreakdowns = mergeOverlappingBreakdowns(jobData.formattedAlarms);
            const numberOfBreakdowns = mergedBreakdowns.length;
            const totalDowntime = mergedBreakdowns.reduce((total, breakdown) => {
                const breakdownDuration = dayjs(breakdown.endDateTime).diff(dayjs(breakdown.startDateTime), 'minute');
                return total + breakdownDuration;
            }, 0);
            const alarmsAboveFiveMinutes = jobData.formattedAlarms.filter(alarm => parseFloat(alarm.duration) >= 5);
            const totalAlarmsDowntime = alarmsAboveFiveMinutes.reduce((total, alarm) => total + parseFloat(alarm.duration), 0);
            const mechanicalDowntime = totalAlarmsDowntime;
            const mechanicalAvailability = (jobData.duration / (jobData.duration + mechanicalDowntime)) * 100;
            const mtbf = numberOfBreakdowns > 0 ? jobData.duration / numberOfBreakdowns : 0;
            const mttr = numberOfBreakdowns > 0 ? totalDowntime / numberOfBreakdowns : 0;
            const availability = jobData.metrics.got && jobData.metrics.batchDuration ? (jobData.metrics.got / jobData.metrics.batchDuration) * 100 : 0;
            const performance = jobData.metrics.not && jobData.metrics.got ? (jobData.metrics.not / jobData.metrics.got) * 100 : 0;
            const oee = jobData.duration > 0 ? (jobData.metrics.vot / jobData.duration) * 100 : 0;
            const recipe = jobData.recipe;

            // Build response (same structure as regular report endpoint)
            const response = {
                reportName: report.name,
                isLive: true,  // ✅ NEW: Flag to indicate live report
                lastUpdate: new Date().toISOString(),  // ✅ NEW: Server timestamp
                general: {
                    lineName: line.name,
                    jobName: job.jobName,
                    startTime: job?.actualStartTime ? dayjs(job.actualStartTime).utc().format('DD/MM/YYYY HH:mm') : null,
                    endTime: null,  // ✅ NULL for running jobs
                    duration: jobData.duration,
                    programName: program.programName || "N/A",
                    recipeName: recipe?.name || "N/A",
                    startupTime: program?.startDate ? dayjs(program.startDate).utc().format('DD/MM/YYYY HH:mm') : null,
                    runoutTime: null,  // ✅ NULL for running jobs
                    programDuration: programDuration,
                    bottleneckStartTime: job?.actualStartTime ? dayjs(job.actualStartTime).utc().format('DD/MM/YYYY HH:mm') : null,
                    bottleneckEndTime: null,  // ✅ NULL for running jobs
                    bottleneckName: bottleneckMachine?.name || "N/A",
                },
                production: {
                    netProduction: jobData.netProduction,
                    fillerCounter: jobData.fillerCount,
                    packerCounter: jobData.casesCount,
                    palCounter: jobData.palletsCount,
                    bottlesLost: jobData.bottlesLost
                },
                kpis: {
                    availability: availability.toFixed(2),
                    performance: performance.toFixed(2),
                    oee: oee.toFixed(2),
                    mtbf: mtbf.toFixed(2),
                    mttr: mttr.toFixed(2),
                    metrics: jobData.metrics,
                    mechanicalAvailability: mechanicalAvailability.toFixed(2),
                },
                paretoData: [jobData.paretoData],
                waterfallData: jobData.waterfallData,
                alarms: jobData.formattedAlarms,
                line: line,
                job: {
                    ...job.toJSON(),
                    isRunning: true  // ✅ Flag for frontend
                },
                machines: line.machines,
                ems: jobData.emsMetrics || {
                    totalKwh: 0,
                    kwhPer8OzCase: 0,
                    kwhPerPack: 0,
                    volumeOfDiesel: parseFloat(volumeOfDiesel) || 0,
                    costOfKwhPerDiesel: 0,
                    pricePerLiter: 0,
                    totalLiters: 0
                },
                manHourMetrics: jobData.manHourMetrics || {
                    casePerManHour: 'N/A',
                    costPerManHour: 'N/A',
                    costPerManHourValue: 0,
                    costPerCase: 'N/A',
                    manHours: manHours || 0
                },
            };

            console.log('=== LIVE REPORT RESPONSE ===');
            console.log('isLive:', response.isLive);
            console.log('Duration:', response.general.duration, 'minutes');
            console.log('Net Production:', response.production.netProduction);
            console.log('lastUpdate:', response.lastUpdate);
            console.log('============================\n');

            res.status(200).json(response);
            
        } catch (error) {
            console.error("Error fetching live report data:", error);
            res.status(500).json({ 
                error: error.message,
                message: "Server error during live report data retrieval"
            });
        }
    },

    // Get reports by access level ID
    getReportsByLevelId: async (req, res) => {
        try {
            const { levelId } = req.params;

            // Get the access level to check allowed reports
            const { Level } = require("../dbInit");
            const level = await Level.findByPk(levelId);
            if (!level) {
                return res.status(404).json({ message: "Access level not found" });
            }

            // If no allowedReports specified, return empty array
            if (!level.allowedReports || level.allowedReports.length === 0) {
                return res.status(200).json([]);
            }

            // Get reports that are in the allowed list
            const reports = await Report.findAll({
                where: {
                    id: level.allowedReports
                },
                order: [['name', 'ASC']]
            });

            res.status(200).json(reports);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Get all reports for level management (admin use)
    getAllReportsForLevelManagement: async (req, res) => {
        try {
            const reports = await Report.findAll({
                attributes: ['id', 'name', 'userId', 'createdAt'],
                order: [['name', 'ASC']]
            });

            res.status(200).json(reports);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // Update volume of diesel for a report
    updateVolumeOfDiesel: async (req, res) => {
        try {
            const { id } = req.params;
            const { volumeOfDiesel } = req.body;

            // Validate input
            if (volumeOfDiesel === undefined || volumeOfDiesel === null) {
                return res.status(400).json({ error: "volumeOfDiesel is required" });
            }

            const volume = parseFloat(volumeOfDiesel);
            if (isNaN(volume) || volume < 0) {
                return res.status(400).json({ error: "volumeOfDiesel must be a valid positive number" });
            }

            const report = await Report.findByPk(id);
            if (!report) {
                return res.status(404).json({ message: "Report not found" });
            }

            await Report.update(
                { volumeOfDiesel: volume },
                { where: { id } }
            );

            const updatedReport = await Report.findByPk(id);
            res.status(200).json({
                message: "Volume of diesel updated successfully",
                report: updatedReport
            });
        } catch (error) {
            console.error("Error updating volume of diesel:", error);
            res.status(500).json({ error: error.message });
        }
    },

    // Update man hours for a report
    updateManHours: async (req, res) => {
        try {
            const { id } = req.params;
            const { manHours } = req.body;

            // Validate input
            if (manHours === undefined || manHours === null) {
                return res.status(400).json({ error: "manHours is required" });
            }

            const hours = parseFloat(manHours);
            if (isNaN(hours) || hours < 0) {
                return res.status(400).json({ error: "manHours must be a valid positive number" });
            }

            const report = await Report.findByPk(id);
            if (!report) {
                return res.status(404).json({ message: "Report not found" });
            }

            await Report.update(
                { manHours: hours },
                { where: { id } }
            );

            const updatedReport = await Report.findByPk(id);
            res.status(200).json({
                message: "Man hours updated successfully",
                report: updatedReport,
            });
        } catch (error) {
            console.error("Error updating man hours:", error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get live Gantt chart data for a report (running job)
    getLiveGanttData: async (req, res) => {
        try {
            console.log('\n=== Report Live Gantt Chart Query Started ===');
            console.log('📊 Report ID:', req.params.id);
            console.log('🕐 Timestamp:', new Date().toISOString());

            const NO_DATA_LABEL = "No Data";
            const NO_DATA_COLOR = "#b0b0b0";

            // Fetch report
            const report = await Report.findByPk(req.params.id);
            if (!report) {
                console.log('❌ ERROR: Report not found');
                return res.status(404).json({ message: "Report not found" });
            }
            console.log('✅ Report found:', report.id);

            // Parse report config
            const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config;
            console.log('📝 Report Config:', JSON.stringify({ 
                selectedJobId: config.selectedJobId,
                selectedLineId: config.selectedLineId,
                selectedProgramId: config.selectedProgramId,
                isRunningJob: config.isRunningJob
            }, null, 2));

            // ZOOM SLIDER: Parse and validate time window parameter
            const timeWindowResult = parseGanttTimeWindow(req.query.hoursBack);
            if (!timeWindowResult.isValid) {
                console.log('⚠️  Invalid hoursBack parameter:', timeWindowResult.error);
                console.log('   Using fallback:', timeWindowResult.hoursBack, 'hours');
            }
            const hoursBack = timeWindowResult.hoursBack;
            const isDefaultZoom = timeWindowResult.isDefault;

            console.log('🔍 Zoom Configuration:', { 
                hoursBack, 
                isDefault: isDefaultZoom,
                source: req.query.hoursBack ? `query parameter (${req.query.hoursBack})` : 'default (4 hours)',
                allowedRange: `${GANTT_ZOOM_CONFIG.MIN_HOURS} - ${GANTT_ZOOM_CONFIG.MAX_HOURS} hours`
            });

            // Get line from config or job (works like dashboard - no running job required)
            let lineId = config.selectedLineId;
            let job = null;

            console.log('\n🔍 Step 1: Finding Line ID...');
            console.log('   Initial lineId from config:', lineId || 'NOT FOUND');

            // Try to get job and line info
            if (config.selectedJobId) {
                console.log('   Trying to get job:', config.selectedJobId);
                job = await Job.findByPk(config.selectedJobId, {
                    attributes: ["id", "actualStartTime", "actualEndTime", "programId", "lineId", "skuId"],
                    include: [
                        { model: Sku, as: "sku", attributes: ["id", "name"] },
                        { model: Program, as: "program", attributes: ["id", "lineId"] }
                    ],
                    raw: false
                });

                if (job) {
                    console.log('   ✅ Job found:', {
                        id: job.id,
                        lineId: job.lineId,
                        programId: job.programId,
                        programLineId: job.program?.lineId
                    });
                    lineId = lineId || job.lineId || (job.program ? job.program.lineId : null);
                    console.log('   LineId after job check:', lineId);
                } else {
                    console.log('   ⚠️  Job not found');
                }
            }

            // If still no lineId, check if config has program
            if (!lineId && config.selectedProgramId) {
                console.log('   Trying to get program:', config.selectedProgramId);
                const program = await Program.findByPk(config.selectedProgramId, {
                    attributes: ["id", "lineId"]
                });
                if (program) {
                    console.log('   ✅ Program found, lineId:', program.lineId);
                    lineId = program.lineId;
                } else {
                    console.log('   ⚠️  Program not found');
                }
            }

            if (!lineId) {
                console.log('❌ ERROR: No line information found after all attempts');
                return res.status(400).json({ 
                    message: "No line information found in report config",
                    note: "Report must have a line (via selectedLineId, job, or program)"
                });
            }

            console.log('✅ Final Line ID:', lineId);
            console.log('📌 Mode: Dashboard-style (no running job required)');

            // Get line with machines
            console.log('\n🔍 Step 2: Getting Line and Machines...');
            const line = await Line.findByPk(lineId, {
                attributes: ["id", "name"],
                include: [
                    { model: Machine, as: "machines", attributes: ["id", "name"] }
                ],
            });

            if (!line) {
                console.log('❌ ERROR: Line not found for ID:', lineId);
                return res.status(404).json({ message: "Line not found" });
            }

            console.log('✅ Line found:', { id: line.id, name: line.name });
            console.log('   Machines:', line.machines.map(m => ({ id: m.id, name: m.name })));

            const machineIds = line.machines.map(m => m.id);
            console.log('   Total machine count:', machineIds.length);

            if (machineIds.length === 0) {
                console.log('❌ ERROR: No machines found for line');
                return res.status(400).json({ message: "No machines found for this line" });
            }

            // Get current time from database
            console.log('\n🔍 Step 3: Getting Time Range...');
            const dbNowResult = await sequelize.query('SELECT NOW() as now', { 
                type: sequelize.QueryTypes.SELECT 
            });
            const now = new Date(dbNowResult[0].now);
            
            // ZOOM SLIDER: Calculate dynamic time window based on hoursBack parameter
            const timeWindow = calculateGanttTimeWindow(now, hoursBack);
            const startTime = timeWindow.startTime;

            console.log('⏰ Time Range (Dynamic Zoom):', {
                now: now.toISOString(),
                startTime: startTime.toISOString(),
                hoursBack: hoursBack,
                durationMinutes: (timeWindow.durationMs / 60000).toFixed(1),
                zoomLevel: isDefaultZoom ? 'default' : 'custom'
            });

            // Get machine state tags (NO filtering - include ALL machines like dashboard)
            console.log('\n🔍 Step 4: Finding Machine State Tags...');
            console.log('   Using ALL machines (including labeller):', machineIds.length);

            // Get machine state tags for ALL machines (like dashboard behavior)
            const machineStateTags = await Tags.findAll({
                where: {
                    taggableId: { [Op.in]: machineIds },
                    taggableType: "machine",
                    name: { [Op.like]: "%State%" }
                },
                attributes: ["id", "name", "ref", "taggableId"],
                raw: true
            });

            console.log('✅ Machine State Tags found:', machineStateTags.length);
            machineStateTags.forEach(tag => {
                const machine = line.machines.find(m => m.id === tag.taggableId);
                console.log(`   - Tag ${tag.id}: ${tag.name} (Machine: ${machine?.name})`);
            });

            if (machineStateTags.length === 0) {
                console.log('❌ ERROR: No machine state tags found');
                console.log('   Searched for machines:', machineIds);
                return res.status(404).json({ 
                    message: "No machine state tags found for selected machines",
                    data: [],
                    job: job
                });
            }

            // Get tag values for the dynamic time window (zoom slider)
            console.log(`\n🔍 Step 5: Fetching Tag Values (Last ${hoursBack} Hours)...`);
            const tagValues = await TagValues.findAll({
                where: {
                    tagId: { [Op.in]: machineStateTags.map(tag => tag.id) },
                    createdAt: {
                        [Op.gte]: sequelize.literal(`DATE_SUB(NOW(), INTERVAL ${hoursBack} HOUR)`)
                    }
                },
                order: [['createdAt', 'ASC']],
                attributes: ["id", "tagId", "value", "createdAt"],
                raw: true
            });

            console.log('✅ Tag Values Found:', {
                count: tagValues.length,
                timeWindow: `${hoursBack} hours`
            });
            
            if (tagValues.length > 0) {
                const firstValue = tagValues[0];
                const lastValue = tagValues[tagValues.length - 1];
                console.log('   First value:', { 
                    time: firstValue.createdAt, 
                    tagId: firstValue.tagId, 
                    value: firstValue.value 
                });
                console.log('   Last value:', { 
                    time: lastValue.createdAt, 
                    tagId: lastValue.tagId, 
                    value: lastValue.value 
                });
            } else {
                console.log(`   ⚠️  No tag values in last ${hoursBack} hours`);
            }

            // Get the latest timestamp
            const latestTimestamp = tagValues.length > 0 
                ? new Date(Math.max(...tagValues.map(tv => new Date(tv.createdAt).getTime())))
                : now;

            console.log('Live Gantt - Latest data timestamp:', latestTimestamp.toISOString());

            // Get machine names (use ALL machines, no filtering)
            const machines = line.machines;
            const machineMap = {};
            machines.forEach(machine => {
                machineMap[machine.id] = machine.name;
            });

            // Transform data for Gantt chart
            const chartData = [];
            const tagMap = {};
            machineStateTags.forEach(tag => {
                tagMap[tag.id] = {
                    machineId: tag.taggableId,
                    machineName: machineMap[tag.taggableId] || `Machine ${tag.taggableId}`,
                    tagName: tag.name
                };
            });

            // Group tag values by machine
            const machineSegments = {};

            tagValues.forEach(tagValue => {
                const tagInfo = tagMap[tagValue.tagId];
                if (!tagInfo) return;

                const machineId = tagInfo.machineId;
                if (!machineSegments[machineId]) {
                    machineSegments[machineId] = {
                        machineName: tagInfo.machineName,
                        segments: []
                    };
                }

                machineSegments[machineId].segments.push({
                    value: tagValue.value,
                    timestamp: tagValue.createdAt
                });
            });

            // Create Gantt chart data structure
            chartData.push([
                { type: "string", id: "Role" },
                { type: "string", id: "State" },
                { type: "string", id: "style", role: "style" },
                { type: "date", id: "Start" },
                { type: "date", id: "End" },
            ]);

            // Process each machine's segments
            Object.values(machineSegments).forEach(machine => {
                const segments = machine.segments.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

                for (let i = 0; i < segments.length; i++) {
                    const currentSegment = segments[i];
                    const nextSegment = segments[i + 1];

                    const startTime = new Date(currentSegment.timestamp);
                    const endTime = nextSegment ? new Date(nextSegment.timestamp) : latestTimestamp;

                    // Get state label and color
                    const stateLabel = STATE_CONFIG.getStateLabel(currentSegment.value);
                    const stateColor = STATE_CONFIG.getStateColorByCode(currentSegment.value);

                    // Debug logging for last segment
                    if (!nextSegment) {
                        console.log(`Live Gantt - ${machine.machineName} last segment:`, {
                            value: currentSegment.value,
                            stateLabel,
                            startTime: startTime.toISOString(),
                            endTime: endTime.toISOString(),
                            duration: ((endTime - startTime) / 1000).toFixed(1) + 's'
                        });
                    }

                    chartData.push([
                        machine.machineName,
                        stateLabel,
                        `color: ${stateColor}`,
                        startTime,
                        endTime
                    ]);
                }
            });

            const response = {
                data: chartData,
                job: job ? {
                    id: job.id,
                    actualStartTime: job.actualStartTime,
                    actualEndTime: job.actualEndTime,
                    programId: job.programId,
                    sku: job.sku ? {
                        id: job.sku.id,
                        name: job.sku.name
                    } : null
                } : null,
                line: {
                    id: line.id,
                    name: line.name
                },
                timeRange: {
                    start: startTime,
                    end: latestTimestamp,
                    hoursBack: hoursBack,
                    zoomConfig: {
                        current: hoursBack,
                        default: GANTT_ZOOM_CONFIG.DEFAULT_HOURS,
                        min: GANTT_ZOOM_CONFIG.MIN_HOURS,
                        max: GANTT_ZOOM_CONFIG.MAX_HOURS,
                        recommendedLevels: GANTT_ZOOM_CONFIG.RECOMMENDED_LEVELS
                    }
                },
                machines: machines.map(m => ({
                    id: m.id,
                    name: m.name
                })),
                note: 'Dashboard-style Live Gantt - shows current machine states'
            };

            console.log('\n✅ Live Gantt Response Generated:');
            console.log('   Chart rows:', chartData.length - 1, '(excluding header)');
            console.log('   Machine count:', machines.length);
            console.log('   Zoom level:', `${hoursBack} hours ${isDefaultZoom ? '(default)' : '(custom)'}`);
            console.log('   Time range:', {
                start: response.timeRange.start.toISOString(),
                end: response.timeRange.end.toISOString(),
                duration: `${hoursBack} hours`
            });
            console.log('   Line:', response.line);
            console.log('   Job:', response.job ? response.job.id : 'none');
            console.log('   Data points:', tagValues.length);
            console.log('=== Report Live Gantt Chart Query Completed ===\n');

            res.json(response);
        } catch (error) {
            console.error("Error executing Report Live Gantt Chart query:", error);
            res.status(500).json({ message: "Server error during live data retrieval" });
        }
    },

    // Get historical Gantt chart data for a report (completed job)
    getHistoricalGanttData: async (req, res) => {
        try {
            console.log('\n=== Report Historical Gantt Chart Query Started ===');
            console.log('📊 Report ID:', req.params.id);
            console.log('🕐 Timestamp:', new Date().toISOString());

            const NO_DATA_LABEL = "No Data";
            const NO_DATA_COLOR = "#b0b0b0";

            // Fetch report
            const report = await Report.findByPk(req.params.id);
            if (!report) {
                console.log('❌ ERROR: Report not found');
                return res.status(404).json({ message: "Report not found" });
            }
            console.log('✅ Report found:', report.id);

            // Parse report config
            const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config;
            console.log('📝 Report Config:', JSON.stringify({ 
                selectedJobId: config.selectedJobId,
                isJobBased: !!config.selectedJobId
            }, null, 2));

            // Must be a job-based report
            if (!config.selectedJobId) {
                return res.status(400).json({ message: "This report is not job-based" });
            }

            // Get job by programId (selectedJobId is actually programId, same as dashboard)
            console.log('\n🔍 Step 1: Getting Job by Program ID...');
            console.log('   Program ID (from config.selectedJobId):', config.selectedJobId);
            
            const job = await Job.findOne({
                where: { programId: config.selectedJobId },
                attributes: ["id", "actualStartTime", "actualEndTime", "programId", "lineId"],
                include: [
                    { model: Program, as: "program", attributes: ["id", "lineId"] }
                ],
                order: [['actualStartTime', 'DESC']],
                raw: false
            });

            if (!job) {
                console.log('❌ ERROR: Job not found');
                console.log('   Searched for programId:', config.selectedJobId);
                console.log('   No job found with this programId');
                return res.status(404).json({ 
                    message: "No job found for selected program",
                    programId: config.selectedJobId,
                    note: "No job exists for this program in the database"
                });
            }

            // Check if job is completed
            if (!job.actualEndTime) {
                console.log('⚠️  Job is still running (actualEndTime is NULL)');
                return res.status(400).json({ 
                    message: "Job is still running. Historical Gantt is only for completed jobs.",
                    isRunning: true
                });
            }

            console.log('✅ Job found (completed):', {
                id: job.id,
                startTime: job.actualStartTime,
                endTime: job.actualEndTime,
                duration: dayjs(job.actualEndTime).diff(dayjs(job.actualStartTime), 'minute') + ' minutes'
            });

            // Get line
            const lineId = job.lineId || job.program?.lineId;
            if (!lineId) {
                return res.status(400).json({ message: "No line found for this job" });
            }

            console.log('\n🔍 Step 2: Getting Line and Machines...');
            const line = await Line.findByPk(lineId, {
                attributes: ["id", "name"],
                include: [
                    { model: Machine, as: "machines", attributes: ["id", "name"] }
                ]
            });

            if (!line) {
                console.log('❌ ERROR: Line not found');
                return res.status(404).json({ message: "Line not found" });
            }

            console.log('✅ Line found:', { id: line.id, name: line.name });
            console.log('   Machines:', line.machines.map(m => ({ id: m.id, name: m.name })));

            const machineIds = line.machines.map(m => m.id);
            if (machineIds.length === 0) {
                return res.status(400).json({ message: "No machines found for this line" });
            }

            // Get machine state tags
            console.log('\n🔍 Step 3: Finding Machine State Tags...');
            const machineStateTags = await Tags.findAll({
                where: {
                    taggableId: { [Op.in]: machineIds },
                    taggableType: "machine",
                    ref: TagRefs.MACHINE_STATE
                },
                attributes: ["id", "name", "ref", "taggableId"],
                raw: true
            });

            console.log('✅ Machine State Tags found:', machineStateTags.length);
            machineStateTags.forEach(tag => {
                const machine = line.machines.find(m => m.id === tag.taggableId);
                console.log(`   - Tag ${tag.id}: ${tag.name} (Machine: ${machine?.name})`);
            });

            if (machineStateTags.length === 0) {
                console.log('❌ ERROR: No machine state tags found');
                return res.status(404).json({ 
                    message: "No machine state tags found for machines"
                });
            }

            // Create machine name mapping
            const machineMap = {};
            line.machines.forEach(machine => {
                machineMap[machine.id] = machine.name;
            });

            const tagMachineMapping = {};
            machineStateTags.forEach(tag => {
                tagMachineMapping[tag.id] = {
                    machineId: tag.taggableId,
                    machineName: machineMap[tag.taggableId] || `Machine ${tag.taggableId}`,
                    tagName: tag.name
                };
            });

            // Fetch tag values for job duration
            console.log('\n🔍 Step 4: Fetching Tag Values (Job Duration)...');
            console.log('   Time range:', {
                start: job.actualStartTime,
                end: job.actualEndTime
            });

            const timelineData = [];

            // Process each machine's state tags
            for (const tag of machineStateTags) {
                const mapping = tagMachineMapping[tag.id];
                const displayName = mapping.machineName;

                const tagValues = await TagValues.findAll({
                    where: {
                        tagId: tag.id,
                        createdAt: {
                            [Op.between]: [job.actualStartTime, job.actualEndTime]
                        }
                    },
                    order: [['createdAt', 'ASC']],
                    attributes: ["id", "tagId", "value", "createdAt"],
                    raw: true
                });

                console.log(`   Machine ${displayName}: ${tagValues.length} state changes`);

                // If no tag values, show "No Data" for entire job
                if (tagValues.length === 0) {
                    timelineData.push([
                        displayName,
                        NO_DATA_LABEL,
                        NO_DATA_COLOR,
                        job.actualStartTime,
                        job.actualEndTime
                    ]);
                    continue;
                }

                // Fill gap at start if needed
                if (new Date(tagValues[0].createdAt) > new Date(job.actualStartTime)) {
                    timelineData.push([
                        displayName,
                        NO_DATA_LABEL,
                        NO_DATA_COLOR,
                        job.actualStartTime,
                        tagValues[0].createdAt
                    ]);
                }

                // Process state changes
                let previousValue = tagValues[0].value;
                let startTime = tagValues[0].createdAt;

                for (let i = 1; i < tagValues.length; i++) {
                    const currentValue = tagValues[i].value;
                    const currentTime = tagValues[i].createdAt;

                    if (currentValue !== previousValue) {
                        // End previous state 1ms before next state starts
                        const endTime = dayjs(currentTime).subtract(1, 'millisecond').toDate();

                        timelineData.push([
                            displayName,
                            STATE_CONFIG.getStateLabel(previousValue),
                            STATE_CONFIG.getStateColorByCode(previousValue),
                            startTime,
                            endTime
                        ]);

                        previousValue = currentValue;
                        startTime = currentTime;
                    }
                }

                // Push last segment
                const lastEndTime = tagValues[tagValues.length - 1].createdAt;
                timelineData.push([
                    displayName,
                    STATE_CONFIG.getStateLabel(previousValue),
                    STATE_CONFIG.getStateColorByCode(previousValue),
                    startTime,
                    lastEndTime
                ]);

                // Fill gap at end if needed
                if (new Date(lastEndTime) < new Date(job.actualEndTime)) {
                    timelineData.push([
                        displayName,
                        NO_DATA_LABEL,
                        NO_DATA_COLOR,
                        lastEndTime,
                        job.actualEndTime
                    ]);
                }
            }

            // Build response
            const chartData = [
                [
                    { type: "string", id: "Machine" },
                    { type: "string", id: "Status" },
                    { type: "string", role: "style" },
                    { type: "date", id: "Start" },
                    { type: "date", id: "End" }
                ],
                ...timelineData
            ];

            const response = {
                data: chartData,
                job: {
                    id: job.id,
                    actualStartTime: job.actualStartTime,
                    actualEndTime: job.actualEndTime,
                    programId: job.programId
                },
                line: {
                    id: line.id,
                    name: line.name
                },
                machines: line.machines.map(m => ({
                    id: m.id,
                    name: m.name
                }))
            };

            console.log('\n✅ Historical Gantt Response Generated:');
            console.log('   Chart rows:', chartData.length - 1, '(excluding header)');
            console.log('   Machine count:', line.machines.length);
            console.log('   Job duration:', {
                start: job.actualStartTime,
                end: job.actualEndTime
            });
            console.log('=== Report Historical Gantt Chart Query Completed ===\n');

            res.json(response);
        } catch (error) {
            console.error("Error executing Report Historical Gantt Chart query:", error);
            res.status(500).json({ message: "Server error during data retrieval" });
        }
    },

    // DEBUG: Timezone diagnostic endpoint to check production environment
    debugTimezone: async (req, res) => {
        try {
            console.log('\n=== TIMEZONE DEBUG ENDPOINT CALLED ===');
            
            // 1. Check Node.js Server Time
            const serverTime = new Date();
            const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            
            // 2. Check MySQL Database Time
            const dbTimeCheck = await sequelize.query(
                `SELECT 
                    @@global.time_zone as global_tz,
                    @@session.time_zone as session_tz,
                    NOW() as db_now,
                    UTC_TIMESTAMP() as db_utc,
                    TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW()) as offset_hours
                `,
                { type: QueryTypes.SELECT }
            );
            
            // 3. Check if there's a running job to test duration calculation
            const runningJob = await Job.findOne({ 
                where: { actualEndTime: null },
                order: [['actualStartTime', 'DESC']],
                include: [{ model: Program, as: 'program' }],
                raw: false
            });
            
            let jobDiagnostic = null;
            if (runningJob) {
                const program = runningJob.program;
                const effectiveEndTime = new Date();
                const jobStartDbg = liveInstantFromDbDate(runningJob.actualStartTime) || dayjs(runningJob.actualStartTime);
                const progStartDbg = program?.startDate
                    ? (liveInstantFromDbDate(program.startDate) || dayjs(program.startDate))
                    : null;
                const jobDuration = dayjs(effectiveEndTime).diff(jobStartDbg, 'minute');
                const programDuration = progStartDbg ? dayjs(effectiveEndTime).diff(progStartDbg, 'minute') : null;
                const timeDiff = progStartDbg ? jobStartDbg.diff(progStartDbg, 'hour', true) : null;
                
                jobDiagnostic = {
                    jobId: runningJob.id,
                    programId: program?.id,
                    jobActualStartTime: runningJob.actualStartTime,
                    programStartDate: program?.startDate,
                    timeDifferenceHours: timeDiff,
                    currentTime: effectiveEndTime.toISOString(),
                    jobDurationMinutes: jobDuration,
                    jobDurationHours: (jobDuration / 60).toFixed(2),
                    programDurationMinutes: programDuration,
                    programDurationHours: programDuration ? (programDuration / 60).toFixed(2) : null,
                    durationMismatch: programDuration && jobDuration ? (programDuration - jobDuration) : null,
                    warning: Math.abs(timeDiff || 0) > 1 ? '⚠️ Job and Program start times differ by >1 hour - possible duration calculation bug!' : null
                };
            }
            
            // 4. Build comprehensive diagnostic response
            const diagnostic = {
                timestamp: new Date().toISOString(),
                environment: 'production',
                server: {
                    nodeJsTime: serverTime.toISOString(),
                    timezone: serverTimezone,
                    processEnvTZ: process.env.TZ || 'not set'
                },
                database: {
                    globalTimezone: dbTimeCheck[0].global_tz,
                    sessionTimezone: dbTimeCheck[0].session_tz,
                    nowFunction: dbTimeCheck[0].db_now,
                    utcTimestamp: dbTimeCheck[0].db_utc,
                    offsetFromUtcHours: dbTimeCheck[0].offset_hours,
                    interpretation: dbTimeCheck[0].offset_hours === 0 
                        ? '✅ NOW() returns UTC time' 
                        : `⚠️ NOW() returns local time with ${dbTimeCheck[0].offset_hours}h offset`
                },
                sequelize: {
                    configuredTimezone: '+00:00',
                    liveReportWallTimezone: LIVE_REPORT_WALL_TIMEZONE,
                },
                runningJobTest: jobDiagnostic,
                recommendations: []
            };
            
            // Add recommendations based on findings
            if (dbTimeCheck[0].offset_hours !== 0) {
                diagnostic.recommendations.push('⚠️ MySQL NOW() is not returning UTC - this causes duration calculation errors');
                diagnostic.recommendations.push('Fix: Ensure MySQL session timezone is +00:00 in Sequelize config');
            }
            
            if (jobDiagnostic?.timeDifferenceHours && Math.abs(jobDiagnostic.timeDifferenceHours) > 1) {
                diagnostic.recommendations.push(`⚠️ Job starts ${jobDiagnostic.timeDifferenceHours.toFixed(2)}h after Program - this causes production count vs duration mismatch`);
                diagnostic.recommendations.push('Fix: Use consistent date source (either Job dates OR Program dates for both counts and duration)');
            }
            
            if (diagnostic.recommendations.length === 0) {
                diagnostic.recommendations.push('✅ No timezone issues detected');
            }
            
            console.log('Diagnostic Results:', JSON.stringify(diagnostic, null, 2));
            
            res.status(200).json(diagnostic);
        } catch (error) {
            console.error('Error in timezone debug endpoint:', error);
            res.status(500).json({ 
                error: error.message,
                stack: error.stack 
            });
        }
    }
};