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
const { QueryTypes } = require("sequelize");
const TagRefs = require("../utils/constants/TagRefs");
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
                
                // Skip if value is "0" or empty (no alarm)
                if (!alarmCode || alarmCode === '0' || alarmCode === 0) {
                    // If we were tracking an alarm, close it
                    if (currentAlarm !== null && alarmStartTime !== null) {
                        const alarmEndTime = currentValue.createdAt;
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
                    const alarmEndTime = currentValue.createdAt;
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
                    alarmStartTime = currentValue.createdAt;
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
    
    const fillerCount = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.BOTTLES_COUNT, job.actualStartTime, effectiveEndTime, program, isLiveMode);
    console.log(`[REPORT] Filler Count (bc): ${fillerCount}`);
    
    const fillerCountAqua = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.BLOWERINPUT, job.actualStartTime, effectiveEndTime, program, isLiveMode);

    console.log(`[REPORT] FillerAqua Count (bc): ${fillerCountAqua}`);

    let bottlesLost = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.REJECTED_BOTTLES, job.actualStartTime, effectiveEndTime, program, isLiveMode);
    console.log(`[REPORT] Bottles Lost (lost): ${bottlesLost}`);
    
    const palletsCount = await getTagValuesDifference({ Tags, TagValues, Op }, line.id, TagRefs.PALLET_COUNT, job.actualStartTime, effectiveEndTime, program, isLiveMode);
    console.log(`[REPORT] Pallets Count (pltsct): ${palletsCount}`);

    // Get SKU configuration for production calculation
    let numberOfContainersPerPack = 1;
    if (job.skuId) {
        const sku = await Sku.findByPk(job.skuId);
        if (sku && sku.numberOfContainersPerPack) {
            numberOfContainersPerPack = sku.numberOfContainersPerPack;
        }
    }

    // Calculate net production using smart fallback (csct → bc) - uses program dates for csct/bc tags
    const productionResult = await getProductionCountWithFallback(
        { Tags, TagValues, Op }, 
        line.id, 
        job.actualStartTime, 
        effectiveEndTime,
        numberOfContainersPerPack,
        program,
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
    const { calculateMetrics, calculateTrueEfficiency } = require("./Kpis.controller.js");
    let metrics = {};
    let metricsTrueEff = { valueOperatingTime: 0, programDuration: 0, trueEfficiency: 0 };
    try {
        const bottleneckMachineId = bottleneckMachine ? bottleneckMachine.id : machineIds[0];
        // Pass netProduction to calculateMetrics so VOT uses netProduction instead of fillerCounter
        metrics = await calculateMetrics(job.id, bottleneckMachineId, line.id, netProduction);
        
        // Only calculate true efficiency for completed jobs (not live reports)
        // For live reports, program.endDate is NULL, which causes calculateTrueEfficiency to throw an error
        if (!isLiveMode && program.endDate) {
            // Pass netProduction to calculateTrueEfficiency so VOT uses netProduction instead of fillerCounter
            metricsTrueEff = await calculateTrueEfficiency(program.id, job.id, line.id, null, netProduction);
            metrics = { ...metrics, ...metricsTrueEff };
        } else if (isLiveMode) {
            console.log('[LIVE REPORT] Skipping calculateTrueEfficiency (program.endDate is NULL for running jobs)');
            // For live reports, use basic metrics without true efficiency calculation
            metrics = { ...metrics, ...metricsTrueEff }; // Use default values
        } else {
            metrics = { ...metrics, ...metricsTrueEff };
        }
    } catch (error) {
        console.error('[REPORT] Error calculating metrics:', error);
        metrics = {
            vot: 0, ql: 0, not: 0, udt: 0, got: 0, slt: 0, sl: 0, batchDuration: 0,
            valueOperatingTime: 0, programDuration: 0, trueEfficiency: 0,
        };
    }
    
    // Calculate duration using effectiveEndTime (NOW() for live, actualEndTime for completed)
    const duration = dayjs(effectiveEndTime).diff(dayjs(job.actualStartTime), "minute");
    
    if (isLiveMode) {
        console.log(`[LIVE REPORT] Duration calculated: ${duration} minutes (from start to NOW)`);
    }

    // Pareto (sunburst)
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
    const bottleneckMachineId = bottleneckMachine ? bottleneckMachine.id : machineIds[0];
    const statesResults = await sequelize.query(statesQuery, {
        replacements: {
            jobId: job.id,
            bottleneckMachineId: bottleneckMachineId
        },
        type: QueryTypes.SELECT,
    });
    const paretoData = prepareParetoData(statesResults);

    // Waterfall
    const waterfallData = prepareWaterfallData(program, job, metrics);

    // Recipe
    let recipe = null;
    if (job.skuId) {
        recipe = await Recipie.findOne({ where: { skuId: job.skuId } });
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
        const sku = job.skuId ? await Sku.findByPk(job.skuId) : null;
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

            // Calculate program duration (for running jobs, use start to NOW)
            let programDuration = null;
            if (program?.startDate) {
                const programStart = dayjs(program.startDate);
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
};