// Utility helpers for report.controller.js
const dayjs = require("dayjs");
const { QueryTypes } = require("sequelize");
const TagRefs = require("../utils/constants/TagRefs");
const fs = require("fs");
const path = require("path");
const EmailService = require("../utils/services/EmailService");
const logger = require("../utils/logger");

// Helper: Log alarm codes without descriptions to a text file
function logMissingAlarmDescription(alarmCode, machineId, machineName) {
    try {
        const logFilePath = path.join(__dirname, '..', 'logs', 'missing-alarm-descriptions.txt');
        const logEntry = `${alarmCode}, ${machineName}\n`;
        
        // Append to file (create if doesn't exist)
        fs.appendFileSync(logFilePath, logEntry);
    } catch (error) {
        console.error('Error logging missing alarm description:', error);
    }
}

// Helper: Get first and last tag values within a time range and return their difference
// For tags: bc, csct, pltsct, bp, lost - uses program dates instead of job dates
// For LIVE reports (program.endDate is NULL), gets the LATEST tag value instead of value at specific end time
async function getTagValuesDifference({ Tags, TagValues, Op }, lineId, tagRef, startTime, endTime, program, isLiveMode = false) {
    try {
        // Tags that should use program dates instead of job dates
        const PROGRAM_BASED_TAG_REFS = ['bc','bc1', 'csct', 'pltsct', 'bp', 'lost'];
        
        // Determine which dates to use
        let actualStartTime = startTime;
        let actualEndTime = endTime;
        let usingProgramDates = false;
        let isLive = isLiveMode || (program && !program.endDate); // Detect live mode
        
        if (program && PROGRAM_BASED_TAG_REFS.includes(tagRef)) {
            if (program.startDate) {
                actualStartTime = program.startDate;
                
                // For live reports, program.endDate is NULL - use provided endTime or skip end filter
                if (program.endDate) {
                    actualEndTime = program.endDate;
                    usingProgramDates = true;
                } else {
                    // Live report - will get latest value instead
                    console.log(`[LIVE REPORT] Program.endDate is NULL for tag ${tagRef} - will fetch LATEST value`);
                    isLive = true;
                }
            } else {
                console.warn(`⚠ Program dates missing for tag ${tagRef}, falling back to provided dates`);
            }
        }
        
        // Log which dates are being used
        console.log(`\n[REPORT] getTagValuesDifference - Tag: ${tagRef}, Line: ${lineId}`);
        console.log(`  Mode: ${isLive ? 'LIVE (get latest value)' : 'HISTORICAL (use end time)'}`);
        console.log(`  Using ${usingProgramDates ? 'PROGRAM' : 'JOB'} dates`);
        console.log(`  Start: ${actualStartTime}`);
        if (!isLive) {
            console.log(`  End: ${actualEndTime}`);
        }
        if (usingProgramDates && program) {
            console.log(`  Program ID: ${program.id}`);
        }
        
        const tag = await Tags.findOne({
            where: {
                taggableId: lineId,
                taggableType: 'line',
                ref: tagRef
            }
        });
        if (!tag) return 0;
        
        const firstValue = await TagValues.findOne({
            where: { tagId: tag.id, createdAt: { [Op.gte]: actualStartTime } },
            order: [['createdAt', 'ASC']]
        });
        
        // For LIVE reports: Get the absolute LATEST tag value (no end time filter)
        // For HISTORICAL reports: Get value at or before end time
        let lastValue;
        if (isLive) {
            console.log(`  [LIVE] Fetching LATEST tag value (no end time filter)...`);
            lastValue = await TagValues.findOne({
                where: { 
                    tagId: tag.id,
                    createdAt: { [Op.gte]: actualStartTime }  // Must be after start
                },
                order: [['createdAt', 'DESC']]  // Get most recent
            });
        } else {
            lastValue = await TagValues.findOne({
                where: { tagId: tag.id, createdAt: { [Op.lte]: actualEndTime } },
                order: [['createdAt', 'DESC']]
            });
        }
        
        if (firstValue && lastValue) {
            const difference = parseFloat(lastValue.value) - parseFloat(firstValue.value);
            console.log(`  First Value: ${firstValue.value} (at ${firstValue.createdAt})`);
            console.log(`  Last Value: ${lastValue.value} (at ${lastValue.createdAt})`);
            console.log(`  Difference: ${difference}`);
            return difference;
        }
        console.log(`  No values found - returning 0`);
        return 0;
    } catch (error) {
        console.error(`Error getting tag values difference for ${tagRef}:`, error);
        return 0;
    }
}

/**
 * Smart Production Counter with Intelligent Fallback
 * 
 * Handles different line configurations:
 * - Krones lines: Use CASE_COUNT (csct) → multiply by numberOfContainersPerPack
 * - Bardi lines: Use BOTTLES_COUNT (bc) → use directly
 * 
 * For csct and bc tags, uses program dates instead of job dates when program is provided.
 * 
 * @param {Object} deps - Dependencies { Tags, TagValues, Op }
 * @param {number} lineId - Line ID
 * @param {Date} startTime - Start time for measurement
 * @param {Date} endTime - End time for measurement
 * @param {number} numberOfContainersPerPack - Bottles per case (from SKU)
 * @param {Object} program - Program object with startDate and endDate (required)
 * @returns {Promise<Object>} { bottleCount: number, method: 'csct'|'bc', source: string }
 */
async function getProductionCountWithFallback({ Tags, TagValues, Op }, lineId, startTime, endTime, numberOfContainersPerPack = 1, program, isLiveMode = false) {
    try {
        // For csct and bc tags, use program dates instead of job dates
        let actualStartTime = startTime;
        let actualEndTime = endTime;
        let usingProgramDates = false;
        let isLive = isLiveMode || (program && !program.endDate); // Detect live mode
        
        if (program) {
            if (program.startDate) {
                actualStartTime = program.startDate;
                
                // For live reports, program.endDate is NULL
                if (program.endDate) {
                    actualEndTime = program.endDate;
                    usingProgramDates = true;
                } else {
                    console.log(`[LIVE REPORT] Program.endDate is NULL - will fetch LATEST production values`);
                    isLive = true;
                }
            } else {
                console.warn(`⚠ Program dates missing, falling back to provided dates for production count`);
            }
        }
        
        // Log which dates are being used
        console.log(`\n[REPORT] getProductionCountWithFallback - Line: ${lineId}`);
        console.log(`  Mode: ${isLive ? 'LIVE (get latest values)' : 'HISTORICAL (use end time)'}`);
        console.log(`  Using ${usingProgramDates ? 'PROGRAM' : 'JOB'} dates`);
        console.log(`  Start: ${actualStartTime}`);
        if (!isLive) {
            console.log(`  End: ${actualEndTime}`);
        }
        console.log(`  Containers per pack: ${numberOfContainersPerPack}`);
        if (usingProgramDates && program) {
            console.log(`  Program ID: ${program.id}`);
        }
        
        // ATTEMPT 1: Try CASE_COUNT first (standard for most lines)
        const caseCountTag = await Tags.findOne({
            where: {
                taggableId: lineId,
                taggableType: 'line',
                ref: TagRefs.CASE_COUNT
            }
        });

        if (caseCountTag) {
            const firstValue = await TagValues.findOne({
                where: { tagId: caseCountTag.id, createdAt: { [Op.gte]: actualStartTime } },
                order: [['createdAt', 'ASC']]
            });
            
            // For LIVE reports: Get the absolute LATEST tag value
            let lastValue;
            if (isLive) {
                lastValue = await TagValues.findOne({
                    where: { 
                        tagId: caseCountTag.id,
                        createdAt: { [Op.gte]: actualStartTime }
                    },
                    order: [['createdAt', 'DESC']]
                });
            } else {
                lastValue = await TagValues.findOne({
                    where: { tagId: caseCountTag.id, createdAt: { [Op.lte]: actualEndTime } },
                    order: [['createdAt', 'DESC']]
                });
            }

            if (firstValue && lastValue) {
                const casesCount = parseFloat(lastValue.value) - parseFloat(firstValue.value);
                const bottleCount = casesCount * numberOfContainersPerPack;
                
                console.log(`✓ Production Counter [Line ${lineId}]: Using CASE_COUNT (csct) - ${casesCount} cases × ${numberOfContainersPerPack} = ${bottleCount} bottles`);
                console.log(`  First Value: ${firstValue.value} (at ${firstValue.createdAt})`);
                console.log(`  Last Value: ${lastValue.value} (at ${lastValue.createdAt})`);
                console.log(`  Cases Count: ${casesCount}, Bottle Count: ${bottleCount}`);
                
                return {
                    bottleCount,
                    casesCount,
                    method: 'csct',
                    source: 'CASE_COUNT',
                    multiplier: numberOfContainersPerPack
                };
            }
        }

        // ATTEMPT 2: Fallback to BOTTLE_COUNT (direct bottle counter - e.g., Bardi lines)
        const bottleCountTag = await Tags.findOne({
            where: {
                taggableId: lineId,
                taggableType: 'line',
                ref: TagRefs.BOTTLES_COUNT
            }
        });

        if (bottleCountTag) {
            const firstValue = await TagValues.findOne({
                where: { tagId: bottleCountTag.id, createdAt: { [Op.gte]: actualStartTime } },
                order: [['createdAt', 'ASC']]
            });
            
            // For LIVE reports: Get the absolute LATEST tag value
            let lastValue;
            if (isLive) {
                lastValue = await TagValues.findOne({
                    where: { 
                        tagId: bottleCountTag.id,
                        createdAt: { [Op.gte]: actualStartTime }
                    },
                    order: [['createdAt', 'DESC']]
                });
            } else {
                lastValue = await TagValues.findOne({
                    where: { tagId: bottleCountTag.id, createdAt: { [Op.lte]: actualEndTime } },
                    order: [['createdAt', 'DESC']]
                });
            }

            if (firstValue && lastValue) {
                const bottleCount = parseFloat(lastValue.value) - parseFloat(firstValue.value);
                
                console.log(`✓ Production Counter [Line ${lineId}]: Using BOTTLE_COUNT (bc) fallback - ${bottleCount} bottles (direct)`);
                console.log(`  First Value: ${firstValue.value} (at ${firstValue.createdAt})`);
                console.log(`  Last Value: ${lastValue.value} (at ${lastValue.createdAt})`);
                console.log(`  Bottle Count: ${bottleCount}`);
                
                return {
                    bottleCount,
                    casesCount: 0, // Not applicable for direct bottle counting
                    method: 'bc',
                    source: 'BOTTLES_COUNT',
                    multiplier: 1
                };
            }
        }

        // FAILURE: No suitable production counter found
        console.warn(`⚠ Production Counter [Line ${lineId}]: No CASE_COUNT or BOTTLE_COUNT tag found. Returning 0.`);
        return {
            bottleCount: 0,
            casesCount: 0,
            method: 'none',
            source: 'NOT_FOUND',
            multiplier: 0
        };

    } catch (error) {
        console.error(`❌ Error getting production count for line ${lineId}:`, error);
        return {
            bottleCount: 0,
            casesCount: 0,
            method: 'error',
            source: 'ERROR',
            multiplier: 0,
            error: error.message
        };
    }
}

// Helper: Format alarms data
function formatAlarms(alarms) {
    const dayjs = require("dayjs");
    return alarms.map((alarm) => {
        let alarmDescription = "N/A";
        if (alarm.alarm_description) {
            alarmDescription = alarm.alarm_description;
        } else if (alarm.alarmCode) {
            alarmDescription = `Alarm Code ${alarm.alarmCode}`;
            // Log alarm code that doesn't have description
            logMissingAlarmDescription(
                alarm.alarmCode, 
                alarm.machineId, 
                alarm.machineName || alarm.machine_name || 'Unknown'
            );
        }
        return {
            id: alarm.id,
            machineId: alarm.machineId,
            machineName: alarm.machineName || alarm.machine_name || 'Unknown',
            alarmCode: alarm.alarmCode,
            alarmDescription: alarmDescription,
            startDateTime: dayjs(alarm.alarmStartDateTime).format("YYYY-MM-DD HH:mm:ss"),
            endDateTime: dayjs(alarm.alarmEndDateTime).format("YYYY-MM-DD HH:mm:ss"),
            duration: parseFloat(alarm.duration || 0).toFixed(2),
            reason: alarm.alarmReasonName || null,
            note: alarm.alarmNote || null,
        };
    });
}

// Helper: Prepare sunburst (pareto) data
function prepareParetoData(statesResults) {
    const totalDuration = statesResults.reduce((sum, state) => sum + parseFloat(state.total_duration), 0);
    const sunburstLabels = [
        "States",
        ...statesResults.map((state) => {
            const percentage = ((parseFloat(state.total_duration) / totalDuration) * 100).toFixed(1);
            return `${state.stateName} (${percentage}%)`;
        }),
    ];
    const sunburstParents = ["", ...statesResults.map(() => "States")];
    const sunburstValues = [totalDuration, ...statesResults.map((state) => parseFloat(state.total_duration))];
    return {
        type: "sunburst",
        labels: sunburstLabels,
        parents: sunburstParents,
        values: sunburstValues,
        branchvalues: "total",
    };
}

// Helper: Prepare waterfall chart data
function prepareWaterfallData(program, job, metrics, isLiveMode = false) {
    const dayjs = require("dayjs");
    const programStart = dayjs(program?.startDate);
    const programEnd = dayjs(program?.endDate);
    const jobStart = dayjs(job.actualStartTime);
    const now = dayjs(new Date());
    
    // For live reports: use NOW() as job end time; for historical: use actualEndTime
    const jobEnd = isLiveMode ? now : dayjs(job.actualEndTime);
    
    // Program Duration: For live, calculate from program start to NOW; for historical, use program dates
    let programDuration;
    if (isLiveMode) {
        // Live mode: Calculate from program start to current time
        programDuration = programStart.isValid() ? Math.max(0, now.diff(programStart, "minute")) : 0;
    } else {
        // Historical mode: Use original logic (program end - program start)
        programDuration = programEnd.diff(programStart, "minute");
    }
    
    // Start Up Time: Same calculation for both modes
    const startUpTime = jobStart.diff(programStart, "minute");
    
    // Run Down Time: For live reports, set to 0 (can't calculate until job ends)
    // For historical reports, use original calculation
    let runDownTime;
    if (isLiveMode) {
        runDownTime = 0; // Will be calculated when job completes
    } else {
        runDownTime = programEnd.diff(jobEnd, "minute");
    }
    
    // Production Time: For live, use start to NOW; for historical, use actual times
    let productionTime;
    if (isLiveMode) {
        productionTime = jobStart.isValid() ? Math.max(0, now.diff(jobStart, "minute")) : 0;
    } else {
        productionTime = jobEnd.diff(jobStart, "minute");
    }
    
    const waterfallDataArray = [
        { label: "Operating Working Time", value: programDuration },
        { label: "Start Up Time", value: -startUpTime },
        { label: "Run Down Time", value: -runDownTime },
        { label: "Production Time", value: productionTime },
        { label: "Breakdown Time", value: -metrics.udt },
        { label: "Gross Operating Time", value: metrics.got },
        { label: "Speed Loss", value: -metrics.slt },
        { label: "Net Operating Time", value: metrics.not },
        { label: "Quality Loss", value: -metrics.ql },
        { label: "Valuable Operating Time", value: metrics.vot },
    ];
    return {
        labels: waterfallDataArray.map((item) => item.label),
        values: waterfallDataArray.map((item) => item.value),
    };
}

// Helper: Calculate mechanical downtime for a machine
async function getMechanicalDowntime({ Tags, TagValues, Op }, machineId, timeType, startTime, endTime) {
    try {
        const tag = await Tags.findOne({
            where: {
                taggableType: "machine",
                taggableId: machineId,
                ref: TagRefs.MACHINE_STATE
            }
        });
        if (!tag) return 0;
        const tagValues = await TagValues.findAll({
            where: {
                tagId: tag.id,
                createdAt: {
                    [Op.gte]: dayjs(startTime).startOf("minute").toDate(),
                    [Op.lte]: dayjs(endTime).endOf("minute").toDate()
                }
            },
            order: [["createdAt", "ASC"]],
        });
        let totalDuration = 0;
        let currentSequence = [];
        for (let i = 0; i < tagValues.length; i++) {
            const value = parseInt(tagValues[i].value);
            if (value === timeType) {
                currentSequence.push(tagValues[i]);
            } else {
                if (currentSequence.length >= 5) {
                    totalDuration += currentSequence.length;
                }
                currentSequence = [];
            }
        }
        if (currentSequence.length >= 5) {
            totalDuration += currentSequence.length;
        }
        return totalDuration;
    } catch (error) {
        console.error("Error in getMechanicalDowntime:", error);
        return 0;
    }
}

// Helper: Merge overlapping breakdowns across machines (union of overlapping windows)
function mergeOverlappingBreakdowns(alarms) {
    if (!alarms || alarms.length === 0) return [];

    // Sort by start time
    const sorted = [...alarms].sort(
        (a, b) => new Date(a.startDateTime) - new Date(b.startDateTime)
    );

    const mergedBreakdowns = [];
    let current = null;

    for (const alarm of sorted) {
        const start = new Date(alarm.startDateTime);
        const end = new Date(alarm.endDateTime);
        if (!current) {
            current = {
                startDateTime: start,
                endDateTime: end,
                machines: [alarm.machineId],
                machineNames: [alarm.machineName],
                alarms: [alarm],
            };
            continue;
        }

        const curStart = new Date(current.startDateTime);
        const curEnd = new Date(current.endDateTime);

        // Overlap or touch
        if (start <= curEnd && end >= curStart) {
            current.startDateTime = new Date(Math.min(curStart, start));
            current.endDateTime = new Date(Math.max(curEnd, end));
            if (!current.machines.includes(alarm.machineId)) {
                current.machines.push(alarm.machineId);
                current.machineNames.push(alarm.machineName);
            }
            current.alarms.push(alarm);
        } else {
            mergedBreakdowns.push(current);
            current = {
                startDateTime: start,
                endDateTime: end,
                machines: [alarm.machineId],
                machineNames: [alarm.machineName],
                alarms: [alarm],
            };
        }
    }

    if (current) mergedBreakdowns.push(current);
    return mergedBreakdowns;
}

/**
 * Calculate total KWH consumption from receiver meters connected to line's location
 * @param {Object} deps - Dependencies { Tags, TagValues, Op, Meters, Unit, sequelize, QueryTypes, Line }
 * @param {number} lineId - Line ID to get location from
 * @param {Date} startTime - Start time for measurement
 * @param {Date} endTime - End time for measurement
 * @returns {Promise<number>} Total KWH consumption
 */
async function calculateTotalKwhConsumption({ Tags, TagValues, Op, Meters, Unit, sequelize, QueryTypes, Line }, lineId, startTime, endTime) {
    try {
        console.log('🔍 [EMS] calculateTotalKwhConsumption - START');
        console.log('  📊 Line ID:', lineId);
        console.log('  ⏰ Start Time:', startTime);
        console.log('  ⏰ End Time:', endTime);

        // Get line to find locationId
        const line = await Line.findByPk(lineId, {
            attributes: ['id', 'locationId']
        });
        
        if (!line || !line.locationId) {
            console.warn('⚠ [EMS] Line not found or has no locationId');
            return 0;
        }
        console.log('  📍 Line Location ID:', line.locationId);

        // Get KWH unit
        const kwhUnit = await Unit.findOne({ where: { name: 'kwh' } });
        if (!kwhUnit) {
            console.warn('⚠ [EMS] KWH unit not found');
            return 0;
        }
        console.log('  ✅ KWH Unit found:', kwhUnit.id, kwhUnit.name);

        // Get receiver meters connected to the line's location (not machines)
        const receiverMeters = await Meters.findAll({
            where: {
                locationId: line.locationId,
                type: 'receiver'
            }
        });

        console.log('  📋 Receiver meters found:', receiverMeters.length);
        if (receiverMeters.length > 0) {
            receiverMeters.forEach(m => {
                console.log(`    - Meter ID: ${m.id}, Name: ${m.name}, Location ID: ${m.locationId}, Machine ID: ${m.machineId || 'NULL'}, Type: ${m.type}`);
            });
        }

        if (!receiverMeters || receiverMeters.length === 0) {
            console.warn('⚠ [EMS] No receiver meters found for location:', line.locationId);
            return 0;
        }

        const meterIds = receiverMeters.map(m => m.id);
        console.log('  📋 Meter IDs to query:', meterIds);
        let totalKwh = 0;

        // Get tags for these meters with KWH unit
        const receiverTags = await Tags.findAll({
            where: {
                taggableId: { [Op.in]: meterIds },
                taggableType: 'meter',
                unitId: kwhUnit.id
            }
        });

        console.log('  🏷️  Receiver tags found:', receiverTags.length);
        if (receiverTags.length > 0) {
            receiverTags.forEach(t => {
                console.log(`    - Tag ID: ${t.id}, Name: ${t.name}, Meter ID: ${t.taggableId}, Unit ID: ${t.unitId}`);
            });
        }

        if (receiverTags.length === 0) {
            console.warn('⚠ [EMS] No KWH tags found for receiver meters');
            return 0;
        }

        // Calculate consumption for each meter tag
        for (const tag of receiverTags) {
            console.log(`  🔄 Processing Tag ID: ${tag.id} (${tag.name})`);
            
            const firstValue = await TagValues.findOne({
                where: { 
                    tagId: tag.id, 
                    createdAt: { [Op.gte]: startTime } 
                },
                order: [['createdAt', 'ASC']]
            });

            const lastValue = await TagValues.findOne({
                where: { 
                    tagId: tag.id, 
                    createdAt: { [Op.lte]: endTime } 
                },
                order: [['createdAt', 'DESC']]
            });

            console.log(`    📈 First Value:`, firstValue ? { value: firstValue.value, createdAt: firstValue.createdAt } : 'NOT FOUND');
            console.log(`    📈 Last Value:`, lastValue ? { value: lastValue.value, createdAt: lastValue.createdAt } : 'NOT FOUND');

            if (firstValue && lastValue) {
                const consumption = parseFloat(lastValue.value) - parseFloat(firstValue.value);
                console.log(`    ✅ Consumption for Tag ${tag.id}: ${consumption} kWH`);
                totalKwh += consumption;
            } else {
                console.warn(`    ⚠ No valid values found for Tag ${tag.id}`);
            }
        }

        console.log('  🎯 [EMS] Total KWH Consumption:', totalKwh);
        console.log('🔍 [EMS] calculateTotalKwhConsumption - END');
        return totalKwh;
    } catch (error) {
        console.error('❌ [EMS] Error calculating total KWH consumption:', error);
        return 0;
    }
}

/**
 * Get price per liter from generator connected to line's location at job start time
 * @param {Object} deps - Dependencies { Generator, Meters, GeneratorMeter, TariffUsage, Tariff, Op, Line }
 * @param {number} lineId - Line ID to get location from
 * @param {Date} jobStartTime - Job start time to find active tariff
 * @returns {Promise<number>} Price per liter (0 if not found)
 */
async function getPricePerLiterAtJobStart({ Generator, Meters, GeneratorMeter, TariffUsage, Tariff, Op, Line, Location }, lineId, jobStartTime) {
    try {
        console.log('🔍 [EMS] getPricePerLiterAtJobStart - START');
        console.log('  📊 Line ID:', lineId);
        console.log('  ⏰ Job Start Time:', jobStartTime);

        // Get line to find locationId
        const line = await Line.findByPk(lineId, {
            attributes: ['id', 'locationId']
        });
        
        if (!line || !line.locationId) {
            console.warn('⚠ [EMS] Line not found or has no locationId');
            return 0;
        }
        console.log('  📍 Line Location ID:', line.locationId);

        // Get meters connected to the line's location (not machines)
        const meters = await Meters.findAll({
            where: {
                locationId: line.locationId
            }
        });

        console.log('  📋 All meters found:', meters.length);
        if (meters.length > 0) {
            meters.forEach(m => {
                console.log(`    - Meter ID: ${m.id}, Name: ${m.name}, Location ID: ${m.locationId}, Machine ID: ${m.machineId || 'NULL'}, Type: ${m.type}`);
            });
        }

        if (!meters || meters.length === 0) {
            console.warn('⚠ [EMS] No meters found for location:', line.locationId);
            return 0;
        }

        const meterIds = meters.map(m => m.id);
        console.log('  📋 Meter IDs to find generators:', meterIds);

        // Get generators connected to these meters
        const generatorMeters = await GeneratorMeter.findAll({
            where: {
                meterId: { [Op.in]: meterIds }
            },
            include: [{
                model: Generator,
                as: 'generator',
                attributes: ['id', 'tariffTypeId']
            }]
        });

        console.log('  ⚡ Generator-Meter connections found:', generatorMeters.length);
        if (generatorMeters.length > 0) {
            generatorMeters.forEach(gm => {
                console.log(`    - Generator ID: ${gm.generatorId}, Meter ID: ${gm.meterId}, TariffType ID: ${gm.generator?.tariffTypeId || 'N/A'}`);
            });
        }

        let generators = [];
        let generatorIds = [];

        if (generatorMeters && generatorMeters.length > 0) {
            // Get generators connected through meters
            generatorIds = [...new Set(generatorMeters.map(gm => gm.generatorId))];
            console.log('  ⚡ Unique Generator IDs from meter connections:', generatorIds);
            
            generators = await Generator.findAll({
                where: { id: { [Op.in]: generatorIds } },
                attributes: ['id', 'tariffTypeId', 'name', 'locationId']
            });
        } else {
            console.warn('⚠ [EMS] No generators connected to meters, trying to find generators by location...');
            
            // Debug: Show all generators in system to understand the data
            const allGenerators = await Generator.findAll({
                attributes: ['id', 'name', 'locationId', 'tariffTypeId'],
                limit: 20,
                order: [['id', 'ASC']]
            });
            console.log('  🔍 Debug: All generators in system (first 20):', allGenerators.length);
            if (allGenerators.length > 0) {
                allGenerators.forEach(g => {
                    console.log(`    - Generator ID: ${g.id}, Name: ${g.name}, Location ID: ${g.locationId}, TariffType ID: ${g.tariffTypeId || 'N/A'}`);
                });
            } else {
                console.warn('    ⚠ No generators exist in the system at all!');
            }
            
            // Fallback: Find generators directly by location (since generators also have locationId)
            generators = await Generator.findAll({
                where: { locationId: line.locationId },
                attributes: ['id', 'tariffTypeId', 'name', 'locationId']
            });
            
            console.log('  ⚡ Generators found by location:', generators.length);
            if (generators.length > 0) {
                generators.forEach(g => {
                    console.log(`    - Generator ID: ${g.id}, Name: ${g.name}, Location ID: ${g.locationId}, TariffType ID: ${g.tariffTypeId || 'N/A'}`);
                });
            } else {
                console.warn(`    ⚠ No generators found at location ${line.locationId}. Trying parent/sibling locations...`);
                
                // Try to find generators at parent location or sibling locations
                const currentLocation = await Location.findByPk(line.locationId, {
                    attributes: ['id', 'name', 'parentLocationId']
                });
                
                if (currentLocation && currentLocation.parentLocationId) {
                    console.log(`  🔍 Line location ${line.locationId} has parent location: ${currentLocation.parentLocationId}`);
                    
                    // Get sibling locations (locations with same parent)
                    const siblingLocations = await Location.findAll({
                        where: { parentLocationId: currentLocation.parentLocationId },
                        attributes: ['id']
                    });
                    const siblingLocationIds = siblingLocations.map(l => l.id);
                    
                    console.log(`  🔍 Sibling locations found: [${siblingLocationIds.join(', ')}]`);
                    
                    // Find generators at sibling locations OR parent location
                    const locationIdsToSearch = [currentLocation.parentLocationId, ...siblingLocationIds];
                    generators = await Generator.findAll({
                        where: {
                            locationId: { [Op.in]: locationIdsToSearch }
                        },
                        attributes: ['id', 'tariffTypeId', 'name', 'locationId']
                    });
                    
                    console.log('  ⚡ Generators found at parent/sibling locations:', generators.length);
                    if (generators.length > 0) {
                        generators.forEach(g => {
                            console.log(`    - Generator ID: ${g.id}, Name: ${g.name}, Location ID: ${g.locationId}, TariffType ID: ${g.tariffTypeId || 'N/A'}`);
                        });
                    } else {
                        console.warn(`    ⚠ No generators found at parent location ${currentLocation.parentLocationId} or sibling locations [${siblingLocationIds.join(', ')}]`);
                    }
                } else {
                    console.warn(`    ⚠ Location ${line.locationId} has no parent location`);
                }
            }
        }

        console.log('  ⚡ Total Generators found:', generators.length);
        if (generators.length > 0) {
            generators.forEach(g => {
                console.log(`    - Generator ID: ${g.id}, Name: ${g.name}, TariffType ID: ${g.tariffTypeId || 'N/A'}`);
            });
        }

        // CRITICAL: Generators are REQUIRED - no fallback logic
        if (generators.length === 0) {
            const errorMessage = `[EMS] ❌ CRITICAL ERROR: No generators found for line location ${line.locationId}`;
            console.error(errorMessage);
            logger.error(errorMessage, {
                lineId: line.id,
                lineName: line.name,
                locationId: line.locationId,
                jobStartTime: jobStartTime,
                function: 'getPricePerLiterAtJobStart'
            });
            
            // Send error email
            await sendEmsErrorEmail({
                errorType: 'NO_GENERATORS_FOUND',
                lineId: line.id,
                lineName: line.name,
                locationId: line.locationId,
                jobStartTime: jobStartTime,
                message: `No generators found for line location ${line.locationId}. Price per liter cannot be calculated.`
            });
            
            console.log('🔍 [EMS] getPricePerLiterAtJobStart - END (ERROR: No generators)');
            return 0;
        }

        // Use the first generator's tariff type
        const generator = generators[0];
        if (!generator || !generator.tariffTypeId) {
            const errorMessage = `[EMS] ❌ CRITICAL ERROR: Generator found but has no tariffTypeId`;
            console.error(errorMessage);
            logger.error(errorMessage, {
                generatorId: generator?.id,
                generatorName: generator?.name,
                lineId: line.id,
                lineName: line.name,
                locationId: line.locationId,
                jobStartTime: jobStartTime,
                function: 'getPricePerLiterAtJobStart'
            });
            
            // Send error email
            await sendEmsErrorEmail({
                errorType: 'GENERATOR_NO_TARIFF_TYPE',
                generatorId: generator?.id,
                generatorName: generator?.name,
                lineId: line.id,
                lineName: line.name,
                locationId: line.locationId,
                jobStartTime: jobStartTime,
                message: `Generator ${generator?.id} (${generator?.name}) has no tariffTypeId. Price per liter cannot be calculated.`
            });
            
            console.log('🔍 [EMS] getPricePerLiterAtJobStart - END (ERROR: No tariffTypeId)');
            return 0;
        }

        const tariffTypeIdToUse = generator.tariffTypeId;
        console.log('  ✅ Using Generator ID:', generator.id, 'Name:', generator.name, 'with TariffType ID:', tariffTypeIdToUse);

        // Find active TariffUsage at job start time
        console.log('  💰 TariffUsage lookup:');
        console.log('    - Job Start Time:', jobStartTime);
        console.log('    - Looking for TariffUsage where startDate <= jobStartTime AND endDate >= jobStartTime');
        console.log('    - With Tariff where typeId =', tariffTypeIdToUse, '(from generator)');

        // Log all recent TariffUsages for debugging
        const allTariffUsages = await TariffUsage.findAll({
            include: [{
                model: Tariff,
                as: 'tariff',
                attributes: ['id', 'typeId', 'pricePerLiter', 'date']
            }],
            order: [['startDate', 'DESC']],
            limit: 10
        });

        console.log('  📋 Recent TariffUsages (last 10):', allTariffUsages.length);
        allTariffUsages.forEach(tu => {
            console.log(`    - TariffUsage ID: ${tu.id}, Start: ${tu.startDate}, End: ${tu.endDate}, Tariff TypeId: ${tu.tariff?.typeId || 'N/A'}, Price/L: ${tu.tariff?.pricePerLiter || 'N/A'}`);
        });

        // Find TariffUsage matching generator's tariffTypeId
        const tariffUsage = await TariffUsage.findOne({
            where: {
                startDate: { [Op.lte]: jobStartTime },
                endDate: { [Op.gte]: jobStartTime }
            },
            include: [{
                model: Tariff,
                as: 'tariff',
                where: { typeId: tariffTypeIdToUse },
                attributes: ['id', 'pricePerLiter', 'date', 'typeId']
            }],
            order: [['startDate', 'DESC']]
        });

        if (tariffUsage && tariffUsage.tariff) {
            const pricePerLiter = parseFloat(tariffUsage.tariff.pricePerLiter) || 0;
            console.log('  ✅ TariffUsage found!');
            console.log('    - TariffUsage ID:', tariffUsage.id);
            console.log('    - Start Date:', tariffUsage.startDate);
            console.log('    - End Date:', tariffUsage.endDate);
            console.log('    - Tariff ID:', tariffUsage.tariff.id);
            console.log('    - Tariff Type ID:', tariffUsage.tariff.typeId);
            console.log('    - Tariff Date:', tariffUsage.tariff.date);
            console.log('    - Price Per Liter:', pricePerLiter);
            console.log('🔍 [EMS] getPricePerLiterAtJobStart - END');
            return pricePerLiter;
        }

        // ERROR: No active TariffUsage found
        const errorMessage = `[EMS] ❌ CRITICAL ERROR: No active TariffUsage found for tariffTypeId ${tariffTypeIdToUse} at job start time`;
        console.error(errorMessage);
        logger.error(errorMessage, {
            lineId: line.id,
            lineName: line.name,
            locationId: line.locationId,
            generatorId: generator.id,
            generatorName: generator.name,
            tariffTypeId: tariffTypeIdToUse,
            jobStartTime: jobStartTime,
            function: 'getPricePerLiterAtJobStart',
            availableTariffUsages: allTariffUsages.map(tu => ({
                id: tu.id,
                startDate: tu.startDate,
                endDate: tu.endDate,
                tariffTypeId: tu.tariff?.typeId,
                pricePerLiter: tu.tariff?.pricePerLiter
            }))
        });
        
        // Send error email
        await sendEmsErrorEmail({
            errorType: 'NO_TARIFF_USAGE_FOUND',
            lineId: line.id,
            lineName: line.name,
            locationId: line.locationId,
            generatorId: generator.id,
            generatorName: generator.name,
            tariffTypeId: tariffTypeIdToUse,
            jobStartTime: jobStartTime,
            availableTariffUsages: allTariffUsages,
            message: `No active TariffUsage found for tariffTypeId ${tariffTypeIdToUse} at job start time ${jobStartTime}. Price per liter cannot be calculated.`
        });
        
        console.log('    - Searched for TariffUsage where:');
        console.log('      startDate <=', jobStartTime);
        console.log('      endDate >=', jobStartTime);
        console.log('      tariff.typeId =', tariffTypeIdToUse);
        console.log('    - This means Price per Liter will be 0, which will make Cost of KWH per Diesel = 0');
        console.log('    - To fix: Create a TariffUsage record that:');
        console.log('      1. Has startDate <= job start time AND endDate >= job start time');
        console.log('      2. References a Tariff with typeId =', tariffTypeIdToUse);
        console.log('      3. Has a Tariff with pricePerLiter > 0');
        console.log('🔍 [EMS] getPricePerLiterAtJobStart - END (ERROR: No TariffUsage)');
        return 0;
    } catch (error) {
        const errorMessage = `[EMS] ❌ CRITICAL ERROR: Exception in getPricePerLiterAtJobStart`;
        console.error(errorMessage, error);
        logger.error(errorMessage, {
            error: error.message,
            stack: error.stack,
            lineId: lineId,
            jobStartTime: jobStartTime,
            function: 'getPricePerLiterAtJobStart'
        });
        
        // Send error email
        await sendEmsErrorEmail({
            errorType: 'EXCEPTION',
            lineId: lineId,
            jobStartTime: jobStartTime,
            error: error.message,
            stack: error.stack,
            message: `Exception occurred while getting price per liter: ${error.message}`
        });
        
        console.log('🔍 [EMS] getPricePerLiterAtJobStart - END (EXCEPTION)');
        return 0;
    }
}

/**
 * Calculate liters from SKU size and bottle count
 * @param {Object} sku - SKU object with sizeValue and sizeUnit
 * @param {number} bottleCount - Number of bottles
 * @returns {number} Total liters
 */
function calculateLitersFromSku(sku, bottleCount) {
    console.log('🔍 [EMS] calculateLitersFromSku - START');
    console.log('  📦 SKU:', sku ? { id: sku.id, name: sku.name, sizeValue: sku.sizeValue, sizeUnit: sku.sizeUnit } : 'NULL');
    console.log('  🍾 Bottle Count:', bottleCount);

    if (!sku || !sku.sizeValue || !bottleCount) {
        console.warn('⚠ [EMS] Missing SKU data or bottle count');
        console.log('🔍 [EMS] calculateLitersFromSku - END (returning 0)');
        return 0;
    }

    const sizeValue = parseFloat(sku.sizeValue);

    console.log('  📏 Size Value:', sizeValue);

    // Simple calculation: size * number of bottles (no unit conversion for now)
    const totalLiters = sizeValue * bottleCount;
    console.log('  🎯 Total Liters:', totalLiters, '(=', sizeValue, '×', bottleCount, ')');
    console.log('🔍 [EMS] calculateLitersFromSku - END');
    return totalLiters;
}

/**
 * Calculate EMS metrics for a job
 * @param {Object} deps - All dependencies
 * @param {Object} job - Job object
 * @param {Object} line - Line object with machines
 * @param {Object} sku - SKU object
 * @param {number} netProduction - Net production (bottles)
 * @param {number} casesCount - Cases count
 * @param {number} volumeOfDiesel - Volume of diesel from report (user input)
 * @returns {Promise<Object>} EMS metrics
 */
async function calculateEmsMetrics(deps, job, program, line, sku, netProduction, casesCount, volumeOfDiesel = 0) {
    try {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🚀 [EMS] calculateEmsMetrics - START');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  📋 Job ID:', job.id);
        console.log('  📋 Job Name:', job.jobName);
        console.log('  📋 Program ID:', program?.id);
        console.log('  📋 Program Name:', program?.programName);
        console.log('  📋 Line ID:', line.id);
        console.log('  📋 Line Name:', line.name);
        console.log('  📦 SKU:', sku ? { id: sku.id, name: sku.name } : 'NULL');
        console.log('  🍾 Net Production (bottles):', netProduction);
        console.log('  📦 Cases Count:', casesCount);
        console.log('  ⛽ Volume of Diesel:', volumeOfDiesel);
        console.log('  ⏰ Job Start:', job.actualStartTime);
        console.log('  ⏰ Job End:', job.actualEndTime);
        console.log('  ⏰ Program Start:', program?.startDate);
        console.log('  ⏰ Program End:', program?.endDate);

        const { Tags, TagValues, Op, Meters, Unit, Generator, GeneratorMeter, TariffUsage, Tariff, sequelize, QueryTypes, Line } = deps;
        
        // Check if line has locationId (required for meter lookup)
        // Meters are connected to location, not machines
        if (!line.locationId) {
            // Fetch line with locationId if not included
            const fullLine = await Line.findByPk(line.id, {
                attributes: ['id', 'name', 'locationId']
            });
            if (fullLine) {
                line.locationId = fullLine.locationId;
            }
        }

        console.log('  📍 Line Location ID:', line.locationId || 'NOT FOUND');

        if (!line.locationId) {
            console.warn('⚠ [EMS] Line has no locationId - cannot find meters');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('🚀 [EMS] calculateEmsMetrics - END (no location)');
            console.log('═══════════════════════════════════════════════════════════');
            return {
                totalKwh: 0,
                kwhPer8OzCase: 0,
                kwhPerPack: 0,
                volumeOfDiesel: volumeOfDiesel || 0,
                costOfKwhPerDiesel: 0,
                pricePerLiter: 0,
                totalLiters: 0
            };
        }

        // Calculate total KWH consumption (using locationId, not machineIds)
        // BA Requirement: KWH should be taken from program duration (start/end), not job duration
        console.log('\n📊 Step 1: Calculating Total KWH Consumption...');
        console.log('  📌 Using Program dates (not Job dates) for KWH calculation per BA requirement');
        
        const totalKwh = await calculateTotalKwhConsumption(
            { Tags, TagValues, Op, Meters, Unit, sequelize, QueryTypes, Line },
            line.id,
            program.startDate,
            program.endDate
        );
        console.log('  ✅ Total KWH (using program dates):', totalKwh);

        // Get price per liter at job start (using locationId, not machineIds)
        console.log('\n💰 Step 2: Getting Price Per Liter...');
        const { Location: LocationModel } = deps;
        const pricePerLiter = await getPricePerLiterAtJobStart(
            { Generator, Meters, GeneratorMeter, TariffUsage, Tariff, Op, Line, Location: LocationModel },
            line.id,
            job.actualStartTime
        );
        console.log('  ✅ Price Per Liter:', pricePerLiter);

        // Calculate liters from SKU
        console.log('\n📏 Step 3: Calculating Total Liters from SKU...');
        const totalLiters = calculateLitersFromSku(sku, netProduction);
        console.log('  ✅ Total Liters:', totalLiters);

        // Calculate metrics
        console.log('\n🧮 Step 4: Calculating Final Metrics...');
        const EIGHT_OZ_CASE_FACTOR = 5.678; // Conversion factor for 8 oz case
        const kwhPer8OzCase = totalLiters > 0 
            ? totalKwh / (totalLiters / EIGHT_OZ_CASE_FACTOR)
            : 0;
        console.log('  📐 kwhPer8OzCase =', totalKwh, '/ (', totalLiters, '/', EIGHT_OZ_CASE_FACTOR, ') =', kwhPer8OzCase);

        const kwhPerPack = casesCount > 0 
            ? totalKwh / casesCount
            : 0;
        console.log('  📐 kwhPerPack =', totalKwh, '/', casesCount, '=', kwhPerPack);

        // Ensure volumeOfDiesel is a number before using toFixed
        const volumeOfDieselNum = parseFloat(volumeOfDiesel) || 0;
        
        // Cost of KWH per Diesel = (Price per Liter × Volume of Diesel) / Total KWH
        // Note: Total KWH is calculated from program duration (start/end), not job duration
        console.log('\n  💰 Cost of KWH per Diesel Calculation:');
        console.log('    - Price per Liter:', pricePerLiter, '/L');
        console.log('    - Volume of Diesel:', volumeOfDieselNum, 'L');
        console.log('    - Total KWH (from program duration):', totalKwh, 'kWH');
        
        const costOfKwhPerDiesel = totalKwh > 0 
            ? (pricePerLiter * volumeOfDieselNum) / totalKwh
            : 0;
        
        console.log('    - Formula: (Price/L × Volume) ÷ Total KWH');
        console.log('    - Calculation: (', pricePerLiter, '×', volumeOfDieselNum, ') ÷', totalKwh, '=', costOfKwhPerDiesel);
        
        if (pricePerLiter === 0) {
            console.warn('    ⚠️  WARNING: Price per Liter is 0! This means:');
            console.warn('       1. No active TariffUsage found at job start time, OR');
            console.warn('       2. TariffUsage exists but Tariff.pricePerLiter is 0/null, OR');
            console.warn('       3. Generator has no tariffTypeId or no matching TariffUsage');
            console.warn('    → Check backend logs for "getPricePerLiterAtJobStart" to see why price is 0');
        }
        
        if (costOfKwhPerDiesel === 0 && pricePerLiter > 0) {
            console.warn('    ⚠️  Cost is 0 because Total KWH is 0 or calculation resulted in 0');
        }

        const result = {
            totalKwh: parseFloat(totalKwh.toFixed(2)),
            kwhPer8OzCase: parseFloat(kwhPer8OzCase.toFixed(4)),
            kwhPerPack: parseFloat(kwhPerPack.toFixed(4)),
            volumeOfDiesel: parseFloat(volumeOfDieselNum.toFixed(2)),
            costOfKwhPerDiesel: parseFloat(costOfKwhPerDiesel.toFixed(2)),
            pricePerLiter: parseFloat(pricePerLiter.toFixed(2)),
            totalLiters: parseFloat(totalLiters.toFixed(2))
        };

        console.log('\n📊 Final EMS Metrics:');
        console.log('  ✅ Total KWH:', result.totalKwh);
        console.log('  ✅ kWH per 8 oz case:', result.kwhPer8OzCase);
        console.log('  ✅ kWH per pack:', result.kwhPerPack);
        console.log('  ✅ Volume of diesel:', result.volumeOfDiesel);
        console.log('  ✅ Cost of kwh per diesel:', result.costOfKwhPerDiesel);
        console.log('  ✅ Price per liter:', result.pricePerLiter);
        console.log('  ✅ Total liters:', result.totalLiters);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🚀 [EMS] calculateEmsMetrics - END');
        console.log('═══════════════════════════════════════════════════════════\n');

        return result;
    } catch (error) {
        console.error('❌ [EMS] Error calculating EMS metrics:', error);
        console.error('  Stack:', error.stack);
        return {
            totalKwh: 0,
            kwhPer8OzCase: 0,
            kwhPerPack: 0,
            volumeOfDiesel: volumeOfDiesel || 0,
            costOfKwhPerDiesel: 0,
            pricePerLiter: 0,
            totalLiters: 0
        };
    }
}

/**
 * Send error email for EMS calculation failures
 * @param {Object} errorData - Error details
 */
async function sendEmsErrorEmail(errorData) {
    const RECIPIENT = 'christian_chindy@hotmail.com';
    
    try {
        const subject = `🚨 [EMS] Critical Error - Price Per Liter Calculation Failed`;
        
        let errorDetailsHtml = '';
        if (errorData.errorType === 'NO_GENERATORS_FOUND') {
            errorDetailsHtml = `
                <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
                    <p><strong>Error Type:</strong> No Generators Found</p>
                    <p><strong>Line ID:</strong> ${errorData.lineId}</p>
                    <p><strong>Line Name:</strong> ${errorData.lineName || 'N/A'}</p>
                    <p><strong>Location ID:</strong> ${errorData.locationId}</p>
                    <p><strong>Job Start Time:</strong> ${errorData.jobStartTime}</p>
                    <p><strong>Message:</strong> ${errorData.message}</p>
                </div>
            `;
        } else if (errorData.errorType === 'GENERATOR_NO_TARIFF_TYPE') {
            errorDetailsHtml = `
                <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
                    <p><strong>Error Type:</strong> Generator Missing Tariff Type</p>
                    <p><strong>Generator ID:</strong> ${errorData.generatorId}</p>
                    <p><strong>Generator Name:</strong> ${errorData.generatorName || 'N/A'}</p>
                    <p><strong>Line ID:</strong> ${errorData.lineId}</p>
                    <p><strong>Line Name:</strong> ${errorData.lineName || 'N/A'}</p>
                    <p><strong>Location ID:</strong> ${errorData.locationId}</p>
                    <p><strong>Job Start Time:</strong> ${errorData.jobStartTime}</p>
                    <p><strong>Message:</strong> ${errorData.message}</p>
                </div>
            `;
        } else if (errorData.errorType === 'NO_TARIFF_USAGE_FOUND') {
            const availableUsages = errorData.availableTariffUsages || [];
            let usagesTable = '<p>No TariffUsages found in system.</p>';
            if (availableUsages.length > 0) {
                usagesTable = `
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <thead>
                            <tr style="background-color: #e3f2fd;">
                                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">ID</th>
                                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Start Date</th>
                                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">End Date</th>
                                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Tariff TypeId</th>
                                <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Price/L</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${availableUsages.map(tu => `
                                <tr>
                                    <td style="border: 1px solid #ddd; padding: 8px;">${tu.id}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px;">${tu.startDate || 'N/A'}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px;">${tu.endDate || 'N/A'}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px;">${tu.tariff?.typeId || 'N/A'}</td>
                                    <td style="border: 1px solid #ddd; padding: 8px;">${tu.tariff?.pricePerLiter || 'N/A'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }
            
            errorDetailsHtml = `
                <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
                    <p><strong>Error Type:</strong> No Active TariffUsage Found</p>
                    <p><strong>Line ID:</strong> ${errorData.lineId}</p>
                    <p><strong>Line Name:</strong> ${errorData.lineName || 'N/A'}</p>
                    <p><strong>Generator ID:</strong> ${errorData.generatorId}</p>
                    <p><strong>Generator Name:</strong> ${errorData.generatorName || 'N/A'}</p>
                    <p><strong>Required Tariff Type ID:</strong> ${errorData.tariffTypeId}</p>
                    <p><strong>Job Start Time:</strong> ${errorData.jobStartTime}</p>
                    <p><strong>Message:</strong> ${errorData.message}</p>
                    <h4 style="margin-top: 20px;">Available TariffUsages in System:</h4>
                    ${usagesTable}
                </div>
            `;
        } else {
            errorDetailsHtml = `
                <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
                    <p><strong>Error Type:</strong> Exception</p>
                    <p><strong>Line ID:</strong> ${errorData.lineId || 'N/A'}</p>
                    <p><strong>Job Start Time:</strong> ${errorData.jobStartTime || 'N/A'}</p>
                    <p><strong>Error:</strong> ${errorData.error || 'Unknown error'}</p>
                    <p><strong>Message:</strong> ${errorData.message}</p>
                    ${errorData.stack ? `<pre style="background-color: #f5f5f5; padding: 10px; overflow-x: auto; font-size: 12px;">${errorData.stack}</pre>` : ''}
                </div>
            `;
        }
        
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
                <h2 style="color: #d32f2f;">🚨 EMS Critical Error - Price Per Liter Calculation Failed</h2>
                
                <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                    <p><strong>⚠️ This is a critical error in the Energy Management System (EMS) section.</strong></p>
                    <p>The price per liter calculation failed, which means:</p>
                    <ul>
                        <li>Price per Liter (at job start) will show: <strong>0.00 /L</strong></li>
                        <li>Cost of KWH per Diesel will show: <strong>0.00</strong></li>
                        <li>All EMS metrics may be incorrect</li>
                    </ul>
                </div>
                
                ${errorDetailsHtml}
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
                    <p>
                        <strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}<br>
                        <strong>Timestamp:</strong> ${new Date().toISOString()}<br>
                        <strong>Function:</strong> getPricePerLiterAtJobStart
                    </p>
                    <p style="margin-top: 15px;">
                        <strong>Action Required:</strong> Please check the application logs and fix the configuration issue.
                    </p>
                </div>
            </div>
        `;
        
        const result = await EmailService.sendEmail({
            to: RECIPIENT,
            subject: subject,
            htmlContent: htmlContent,
            metadata: {
                type: 'ems_critical_error',
                errorType: errorData.errorType,
                lineId: errorData.lineId,
                timestamp: new Date().toISOString()
            }
        });
        
        if (result.success) {
            console.log(`📧 [EMS] Error email sent successfully to ${RECIPIENT}`);
            logger.info(`[EMS] Error email sent successfully`, {
                recipient: RECIPIENT,
                errorType: errorData.errorType,
                lineId: errorData.lineId
            });
        } else {
            console.error(`❌ [EMS] Failed to send error email to ${RECIPIENT}:`, result.error || result.message);
            logger.error(`[EMS] Failed to send error email`, {
                recipient: RECIPIENT,
                error: result.error || result.message,
                errorType: errorData.errorType
            });
        }
    } catch (emailError) {
        console.error(`❌ [EMS] Exception while sending error email:`, emailError);
        logger.error(`[EMS] Exception while sending error email`, {
            error: emailError.message,
            stack: emailError.stack
        });
    }
}

/**
 * Calculate man hour metrics for a report
 * @param {Object} deps - Dependencies (Settings, Line, etc.)
 * @param {Object} job - Job data
 * @param {Object} line - Line data
 * @param {Number} casesCount - Number of cases produced
 * @param {Number} manHours - User input for man hours (default 0)
 * @returns {Object} - { casePerManHour, costPerManHour, costPerManHourValue }
 */
async function calculateManHourMetrics(deps, job, line, casesCount, manHours = 0) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 [MAN HOUR] calculateManHourMetrics - START');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  📋 Job ID:', job.id);
    console.log('  📋 Line ID:', line.id, 'Name:', line.name);
    console.log('  📋 Cases Count:', casesCount);
    console.log('  📋 Man Hours (user input):', manHours);

    try {
        const { Settings } = deps;
        
        // Ensure manHours is a number
        const manHoursNum = parseFloat(manHours) || 0;
        
        // If manHours is 0, return N/A values
        if (manHoursNum === 0) {
            console.log('  ⚠️  Man Hours is 0 - returning N/A values');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('🚀 [MAN HOUR] calculateManHourMetrics - END (N/A)');
            console.log('═══════════════════════════════════════════════════════════\n');
            return {
                casePerManHour: 'N/A',
                costPerManHour: 'N/A',
                costPerManHourValue: 0,
                costPerCase: 'N/A',
                manHours: 0
            };
        }

        // Get global cost per man hour from Settings (id = 1)
        let settings = await Settings.findByPk(1);
        
        if (!settings) {
            console.warn('⚠ [MAN HOUR] Settings not found - creating default');
            // Create default settings if not exists
            settings = await Settings.create({
                id: 1,
                costPerManHour: 0,
            });
        }

        const costPerManHourValue = parseFloat(settings.costPerManHour) || 0;
        console.log('  💰 Global Cost per Man Hour (from Settings):', costPerManHourValue);

        // Calculate Case per Man Hour = Cases ÷ Man Hours

        // Calculate Case per Man Hour = Cases ÷ Man Hours
        const casePerManHour = casesCount > 0 
            ? parseFloat((casesCount / manHoursNum).toFixed(2))
            : 0;
        console.log('  📐 Case per Man Hour =', casesCount, '÷', manHoursNum, '=', casePerManHour);

        // Calculate Cost per Man Hour = Man Hours × Cost per Man Hour (from Settings)
        const costPerManHour = costPerManHourValue > 0
            ? parseFloat((manHoursNum * costPerManHourValue).toFixed(2))
            : 0;
        console.log('  💰 Cost per Man Hour =', manHoursNum, '×', costPerManHourValue, '=', costPerManHour);

        // Calculate Cost per Case = Total Labor Cost ÷ Total Cases
        const costPerCase = casesCount > 0 && costPerManHour > 0
            ? parseFloat((costPerManHour / casesCount).toFixed(4))
            : 0;
        console.log('  💰 Cost per Case =', costPerManHour, '÷', casesCount, '=', costPerCase);

        const result = {
            casePerManHour: casePerManHour,
            costPerManHour: costPerManHour > 0 ? costPerManHour : 'N/A',
            costPerManHourValue: costPerManHourValue,
            costPerCase: costPerCase > 0 ? costPerCase : 'N/A',
            manHours: manHoursNum
        };

        console.log('\n📊 Final Man Hour Metrics:');
        console.log('  ✅ Case per Man Hour:', result.casePerManHour);
        console.log('  ✅ Cost per Man Hour:', result.costPerManHour);
        console.log('  ✅ Cost per Man Hour (Settings Value):', result.costPerManHourValue);
        console.log('  ✅ Cost per Case:', result.costPerCase);
        console.log('  ✅ Man Hours:', result.manHours);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🚀 [MAN HOUR] calculateManHourMetrics - END');
        console.log('═══════════════════════════════════════════════════════════\n');

        return result;
    } catch (error) {
        console.error('❌ [MAN HOUR] Error calculating man hour metrics:', error);
        console.error('  Stack:', error.stack);
        return {
            casePerManHour: 'N/A',
            costPerManHour: 'N/A',
            costPerManHourValue: 0,
            costPerCase: 'N/A',
            manHours: parseFloat(manHours) || 0
        };
    }
}

module.exports = {
    getTagValuesDifference,
    getProductionCountWithFallback,
    formatAlarms,
    prepareParetoData,
    prepareWaterfallData,
    getMechanicalDowntime,
    mergeOverlappingBreakdowns,
    calculateEmsMetrics,
    calculateTotalKwhConsumption,
    getPricePerLiterAtJobStart,
    calculateLitersFromSku,
    calculateManHourMetrics,
}; 