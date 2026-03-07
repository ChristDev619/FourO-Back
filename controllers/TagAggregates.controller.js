const dayjs = require("dayjs");
const db = require("../dbInit");
const {
    TagValues,
    Op,
    sequelize,
} = require("../dbInit");

const { fn, col, literal, QueryTypes } = require("sequelize");
const TagRefs = require("../utils/constants/TagRefs");



/**
 * Helper function to check if a machine produced during the job
 * Checks if OutputTotal INCREASED during the job period (counters are cumulative, never 0)
 * Returns: { qualified: boolean, productionStartTime: Date|null }
 * Note: OutputTotal tags can be at machine level OR line level (e.g., Blower, Robopac)
 */
async function checkMachineQualification(machineId, job, transaction) {
    console.log(`\n  🔍 Checking qualification for Machine ID: ${machineId}`);
    console.log(`     Job Start: ${job.actualStartTime}, Job End: ${job.actualEndTime}`);
    
    try {
        // ATTEMPT 1: Find machine's own OutputTotal tag
        console.log(`     🔎 Searching for OutputTotal tag at MACHINE level...`);
        let outputTag = await db.Tags.findOne({
            where: {
                taggableType: 'machine',
                taggableId: machineId,
                name: { [Op.like]: '%_OutputTotal' }
            },
            transaction
        });

        // ATTEMPT 2: If not found at machine level, check line level using machine name prefix
        // Some machines (like Blower, Robopac) have OutputTotal at line level
        // IMPORTANT: Use machine name to find the correct tag (avoid picking wrong machine's tag)
        if (!outputTag) {
            console.log(`     ⚠️  Not found at machine level, trying LINE level (lineId: ${job.lineId})...`);

            // Get machine name to build the correct tag name prefix
            const machine = await db.Machine.findOne({
                where: { id: machineId },
                attributes: ['id', 'name'],
                transaction
            });

            if (machine) {
                // Build name prefix like "KL1_Robopac_" from machine name "Robopac"
                // Tag names follow pattern: {linePrefix}_{MachineName}_OutputTotal
                outputTag = await db.Tags.findOne({
                    where: {
                        taggableType: 'line',
                        taggableId: job.lineId,
                        name: { [Op.like]: `%${machine.name}%OutputTotal` }
                    },
                    transaction
                });
            }

            if (outputTag) {
                console.log(`     ✅ Found OutputTotal tag at LINE level! (tagId: ${outputTag.id}, name: ${outputTag.name})`);
            }
        } else {
            console.log(`     ✅ Found OutputTotal tag at MACHINE level! (tagId: ${outputTag.id}, name: ${outputTag.name})`);
        }

        if (!outputTag) {
            console.log(`     ❌ DISQUALIFIED: No OutputTotal tag found (checked both machine and line level)`);
            return { qualified: false, productionStartTime: null };
        }

        // FIXED: Check if OutputTotal INCREASED during the job
        // OutputTotal counters are cumulative and never reset to 0, so we need to compare start vs end values
        console.log(`     🔎 Checking if OutputTotal increased during the job...`);
        
        // Get value at or BEFORE job start (baseline)
        const firstValueRecord = await db.TagValues.findOne({
            where: {
                tagId: outputTag.id,
                createdAt: { [Op.lte]: job.actualStartTime }
            },
            order: [['createdAt', 'DESC']],
            transaction
        });

        // Get value at or BEFORE job end
        const lastValueRecord = await db.TagValues.findOne({
            where: {
                tagId: outputTag.id,
                createdAt: { [Op.lte]: job.actualEndTime }
            },
            order: [['createdAt', 'DESC']],
            transaction
        });

        if (!firstValueRecord || !lastValueRecord) {
            console.log(`     ❌ DISQUALIFIED: Insufficient OutputTotal data during the job`);
            return { qualified: false, productionStartTime: null };
        }

        const firstValue = parseFloat(firstValueRecord.value);
        const lastValue = parseFloat(lastValueRecord.value);

        if (lastValue > firstValue) {
            console.log(`     ✅ QUALIFIED: OutputTotal increased from ${firstValue} → ${lastValue} (produced ${lastValue - firstValue} units)`);
            return { qualified: true, productionStartTime: job.actualStartTime };
        } else {
            console.log(`     ❌ DISQUALIFIED: OutputTotal did NOT increase during job (${firstValue} → ${lastValue})`);
            return { qualified: false, productionStartTime: null };
        }
    } catch (error) {
        console.error(`     ❌ ERROR checking qualification for machine ${machineId}:`, error);
        return { qualified: false, productionStartTime: null };
    }
}

/**
 * Helper function to check if OutputTotal increased during a specific alarm period
 * Returns: { increased: boolean, firstValue: number|null, lastValue: number|null, outputTag: object|null }
 * Note: OutputTotal tags can be at machine level OR line level (e.g., Blower, Robopac)
 */
async function checkOutputTotalDuringAlarm(machineId, lineId, alarmStartTime, alarmEndTime, transaction) {
    try {
        // ATTEMPT 1: Find machine's own OutputTotal tag
        let outputTag = await db.Tags.findOne({
            where: {
                taggableType: 'machine',
                taggableId: machineId,
                name: { [Op.like]: '%_OutputTotal' }
            },
            transaction
        });

        // ATTEMPT 2: If not found at machine level, check line level using machine name prefix
        // IMPORTANT: Use machine name to find the correct tag (avoid picking wrong machine's tag)
        if (!outputTag) {
            const machine = await db.Machine.findOne({
                where: { id: machineId },
                attributes: ['id', 'name'],
                transaction
            });

            if (machine) {
                outputTag = await db.Tags.findOne({
                    where: {
                        taggableType: 'line',
                        taggableId: lineId,
                        name: { [Op.like]: `%${machine.name}%OutputTotal` }
                    },
                    transaction
                });
            }
        }

        if (!outputTag) {
            // No OutputTotal tag found - can't determine if production occurred
            return { increased: false, firstValue: null, lastValue: null, outputTag: null };
        }

        // FIXED: Get value at or BEFORE alarm start (not after!)
        // This ensures we're comparing the counter value AT the start of the alarm
        const firstValueRecord = await db.TagValues.findOne({
            where: {
                tagId: outputTag.id,
                createdAt: { [Op.lte]: alarmStartTime }  // Changed: <= instead of >=
            },
            order: [['createdAt', 'DESC']],  // Changed: DESC to get closest value before/at alarm start
            transaction
        });

        // Get value at or BEFORE alarm end
        const lastValueRecord = await db.TagValues.findOne({
            where: {
                tagId: outputTag.id,
                createdAt: { [Op.lte]: alarmEndTime }
            },
            order: [['createdAt', 'DESC']],
            transaction
        });

        // If we don't have both values, we can't determine if production occurred
        if (!firstValueRecord || !lastValueRecord) {
            return { increased: false, firstValue: null, lastValue: null, outputTag: outputTag };
        }

        const firstValue = parseFloat(firstValueRecord.value);
        const lastValue = parseFloat(lastValueRecord.value);
        const increased = lastValue > firstValue;

        return { increased, firstValue, lastValue, outputTag: outputTag };
    } catch (error) {
        console.error(`     ❌ ERROR checking OutputTotal during alarm for machine ${machineId}:`, error);
        return { increased: false, firstValue: null, lastValue: null, outputTag: null };
    }
}

async function aggregateAlarms(specificJobId = null, transaction = null) {
    try {
        console.log('\n========================================');
        console.log('🚀 ALARM AGGREGATION WITH 2 PHASES STARTED');
        console.log('========================================\n');

        // If specificJobId is provided, process only that job; otherwise process all unprocessed jobs
        let jobs;

        if (specificJobId) {
            // Process specific job
            const jobQueryOptions = {
                where: {
                    id: specificJobId,
                    actualStartTime: { [Op.not]: null },
                    actualEndTime: { [Op.not]: null },
                }
            };
            if (transaction) jobQueryOptions.transaction = transaction;

            jobs = await db.Job.findAll(jobQueryOptions);
        } else {
            // Find jobs that haven't been processed for alarms yet
            const aggregationQueryOptions = {
                attributes: ["jobId"],
                group: ["jobId"],
            };
            if (transaction) aggregationQueryOptions.transaction = transaction;

            const processedJobIds = await db.AlarmAggregation.findAll(aggregationQueryOptions)
                .then((results) => results.map((result) => result.jobId));

            const jobQueryOptions = {
                where: {
                    actualStartTime: { [Op.not]: null },
                    actualEndTime: { [Op.not]: null },
                    id: { [Op.notIn]: processedJobIds },
                }
            };
            if (transaction) jobQueryOptions.transaction = transaction;

            jobs = await db.Job.findAll(jobQueryOptions);
        }

        for (const job of jobs) {
            console.log(`\n📋 Processing Job ${job.id} (${job.actualStartTime} - ${job.actualEndTime})`);

            // Use JobLineMachineTag to get related data
            const machineTagQueryOptions = {
                where: {
                    jobId: job.id,
                    ref: TagRefs.FIRST_FAULT,
                },
                attributes: [
                    "jobId",
                    "jobName",
                    "lineId",
                    "lineName",
                    "machineId",
                    "machineName",
                    "tagId",
                    "tagName",
                ],
                group: ["machineId", "tagId"],
            };
            if (transaction) machineTagQueryOptions.transaction = transaction;

            const machineAlarmTags = await db.JobLineMachineTag.findAll(machineTagQueryOptions);

            // ============================================================
            // PHASE 1: MACHINE QUALIFICATION
            // ============================================================
            console.log('\n--- PHASE 1: Machine Qualification Check ---');
            
            const machineQualification = {}; // { machineId: { qualified: boolean, productionStartTime: Date } }
            
            // Check qualification for each machine
            for (const machineTag of machineAlarmTags) {
                if (!(machineTag.machineId in machineQualification)) {
                    const result = await checkMachineQualification(machineTag.machineId, job, transaction);
                    machineQualification[machineTag.machineId] = result;
                }
            }

            console.log(`\n📊 Machine Qualification Summary:`);
            const qualifiedCount = Object.values(machineQualification).filter(q => q.qualified).length;
            const totalCount = Object.keys(machineQualification).length;
            console.log(`   Total machines: ${totalCount}, Qualified: ${qualifiedCount}, Not Qualified: ${totalCount - qualifiedCount}`);
            Object.entries(machineQualification).forEach(([machineId, result]) => {
                if (result.qualified) {
                    console.log(`   Machine ${machineId}: ✅ QUALIFIED (production start: ${result.productionStartTime})`);
                } else {
                    console.log(`   Machine ${machineId}: ❌ NOT QUALIFIED`);
                }
            });

            // ============================================================
            // PHASE 2: COLLECT QUALIFYING ALARMS (production during alarm - any duration)
            // NOTE: Duration >= 10 min filter is applied at query time in reports/breakdowns
            // ============================================================
            console.log('\n--- PHASE 2: Collect Qualifying Alarms (production during alarm - any duration) ---\n');

            let totalAlarmsFound = 0;
            let totalAlarmsNotProducing = 0;
            let totalAlarmsSaved = 0;

            for (const machineTag of machineAlarmTags) {
                // Skip non-qualified machines
                const qualification = machineQualification[machineTag.machineId];
                if (!qualification || !qualification.qualified) {
                    console.log(`\n⏩ SKIPPING machine ${machineTag.machineName} (machineId: ${machineTag.machineId}) - NOT QUALIFIED (never produced)`);
                    continue;
                }
                
                console.log(`\n🔍 Processing alarms for ${machineTag.machineName} (machineId: ${machineTag.machineId})`);
                console.log(`   Tag: ${machineTag.tagName} (tagId: ${machineTag.tagId})`);
                console.log(`   ✅ Machine qualified (production detected at ${qualification.productionStartTime})`);
                console.log(`   ⏰ Checking ALL alarms from JOB START: ${job.actualStartTime} to JOB END: ${job.actualEndTime}`);

                // Get tag values from JOB START to JOB END (not production start!)
                const queryOptions = {
                    where: {
                        tagId: machineTag.tagId,
                        createdAt: {
                            [Op.between]: [job.actualStartTime, job.actualEndTime],
                        },
                    },
                    order: [["createdAt", "ASC"]],
                };
                if (transaction) queryOptions.transaction = transaction;

                const tagValues = await TagValues.findAll(queryOptions);

                console.log(`   📊 Found ${tagValues.length} tag values from job start to job end`);

                if (tagValues.length < 2) {
                    console.log(`   ⚠️  Not enough tag values to form alarm sequences (need at least 2)`);
                    continue;
                }

                // Process alarm sequences
                let currentAlarm = null;
                let alarmStartTime = null;
                let machineAlarmsFound = 0;

                console.log(`   🔄 Processing alarm sequences...`);

                for (let i = 0; i < tagValues.length - 1; i++) {
                    const currentValue = tagValues[i];
                    const nextValue = tagValues[i + 1];

                    // Skip if current value is 0 and we're not in an alarm sequence
                    if (currentValue.value === "0" && currentAlarm === null) {
                        continue;
                    }

                    // Start of new alarm sequence
                    if (currentAlarm === null && currentValue.value !== "0") {
                        currentAlarm = currentValue.value;
                        alarmStartTime = currentValue.createdAt;
                        console.log(`\n      🚨 Alarm #${currentAlarm} STARTED at ${alarmStartTime}`);
                    }

                    // End of current alarm sequence (when next value is different)
                    if (currentAlarm !== null && nextValue.value !== currentAlarm) {
                        machineAlarmsFound++;
                        totalAlarmsFound++;
                        
                        // Calculate duration in minutes
                        const startDate = new Date(alarmStartTime);
                        const endDate = new Date(nextValue.createdAt);
                        const durationMinutes = (endDate - startDate) / (1000 * 60);

                        console.log(`      ⏹️  Alarm #${currentAlarm} ENDED at ${nextValue.createdAt}`);
                        console.log(`      ⏱️  Duration: ${durationMinutes.toFixed(2)} minutes`);

                        // Check OutputTotal increased during THIS alarm (required for all alarms)
                        // Duration filter (>= 10 min) is applied at query time (reports/breakdowns), not here
                        const outputCheck = await checkOutputTotalDuringAlarm(
                            machineTag.machineId,
                            machineTag.lineId,
                            alarmStartTime,
                            nextValue.createdAt,
                            transaction
                        );

                        if (outputCheck.increased) {
                            totalAlarmsSaved++;
                            console.log(`      ✅ SAVED: Production confirmed during alarm (OutputTotal: ${outputCheck.firstValue} → ${outputCheck.lastValue})`);

                            const createOptions = {
                                jobId: job.id,
                                machineId: machineTag.machineId,
                                machineName: machineTag.machineName,
                                tagId: machineTag.tagId,
                                tagName: machineTag.tagName,
                                lineId: machineTag.lineId,
                                lineName: machineTag.lineName,
                                alarmCode: currentAlarm,
                                alarmStartDateTime: alarmStartTime,
                                alarmEndDateTime: nextValue.createdAt,
                                duration: durationMinutes,
                                processed: true,
                            };
                            const createQueryOptions = {};
                            if (transaction) createQueryOptions.transaction = transaction;

                            await db.AlarmAggregation.create(createOptions, createQueryOptions);
                        } else {
                            totalAlarmsNotProducing++;
                            console.log(`      ❌ DISMISSED: No production during alarm (OutputTotal: ${outputCheck.firstValue} → ${outputCheck.lastValue})`);
                        }

                        // Reset tracker if next value is 0, otherwise start new sequence
                        if (nextValue.value === "0") {
                            currentAlarm = null;
                            alarmStartTime = null;
                        } else {
                            currentAlarm = nextValue.value;
                            alarmStartTime = nextValue.createdAt;
                            console.log(`\n      🚨 Alarm #${currentAlarm} STARTED at ${alarmStartTime}`);
                        }
                    }
                }

                // Handle last alarm sequence if exists
                const lastValue = tagValues[tagValues.length - 1];
                if (currentAlarm !== null && lastValue.value === currentAlarm) {
                    machineAlarmsFound++;
                    totalAlarmsFound++;
                    
                    // Calculate duration in minutes for the last sequence
                    const startDate = new Date(alarmStartTime);
                    const endDate = new Date(lastValue.createdAt);
                    const durationMinutes = (endDate - startDate) / (1000 * 60);

                    console.log(`      ⏹️  Alarm #${currentAlarm} ENDED at ${lastValue.createdAt} (LAST SEQUENCE)`);
                    console.log(`      ⏱️  Duration: ${durationMinutes.toFixed(2)} minutes`);

                    // Check OutputTotal increased during THIS alarm (required for all alarms)
                    // Duration filter (>= 10 min) is applied at query time (reports/breakdowns), not here
                    const outputCheck = await checkOutputTotalDuringAlarm(
                        machineTag.machineId,
                        machineTag.lineId,
                        alarmStartTime,
                        lastValue.createdAt,
                        transaction
                    );

                    if (outputCheck.increased) {
                        totalAlarmsSaved++;
                        console.log(`      ✅ SAVED: Production confirmed during alarm (OutputTotal: ${outputCheck.firstValue} → ${outputCheck.lastValue})`);

                        const createOptions = {
                            jobId: job.id,
                            machineId: machineTag.machineId,
                            machineName: machineTag.machineName,
                            tagId: machineTag.tagId,
                            tagName: machineTag.tagName,
                            lineId: machineTag.lineId,
                            lineName: machineTag.lineName,
                            alarmCode: currentAlarm,
                            alarmStartDateTime: alarmStartTime,
                            alarmEndDateTime: lastValue.createdAt,
                            duration: durationMinutes,
                            processed: true,
                        };
                        const createQueryOptions = {};
                        if (transaction) createQueryOptions.transaction = transaction;

                        await db.AlarmAggregation.create(createOptions, createQueryOptions);
                    } else {
                        totalAlarmsNotProducing++;
                        console.log(`      ❌ DISMISSED: No production during alarm (OutputTotal: ${outputCheck.firstValue} → ${outputCheck.lastValue})`);
                    }
                }

                console.log(`\n   📊 Machine Summary: Found ${machineAlarmsFound} alarm(s)`);
            }

            console.log('\n========================================');
            console.log(`📊 JOB ${job.id} SUMMARY`);
            console.log('========================================');
            console.log(`Total alarms found: ${totalAlarmsFound}`);
            console.log(`  ✅ Saved (production confirmed during alarm): ${totalAlarmsSaved}`);
            console.log(`  ❌ Dismissed (no production during alarm): ${totalAlarmsNotProducing}`);
            console.log('========================================\n');
            console.log(`✅ Job ${job.id} alarm aggregation completed!`);
        }

        console.log('\n========================================');
        console.log('✅ ALARM AGGREGATION COMPLETED SUCCESSFULLY');
        console.log('========================================\n');
    } catch (error) {
        console.error("Error aggregating alarms:", error);
    }
}

async function aggregateMachineStates(specificJobId = null, transaction = null) {
    // Use provided transaction or create a new one
    let localTransaction = transaction;
    if (!localTransaction) {
        localTransaction = await sequelize.transaction();
    }

    try {
        // If specificJobId is provided, process only that job; otherwise process all unprocessed jobs
        let jobs;

        if (specificJobId) {
            // Process specific job
            jobs = await db.Job.findAll({
                where: {
                    id: specificJobId,
                    actualStartTime: { [Op.not]: null },
                    actualEndTime: { [Op.not]: null },
                },
                include: [{
                    model: db.Line,
                    as: "line"
                }],
                transaction: localTransaction
            });
        } else {
            // Find jobs that haven't been processed for machine states yet
            const processedJobIds = await db.MachineStateAggregation.findAll({
                attributes: ["jobId"],
                group: ["jobId"],
                transaction: localTransaction
            }).then(results => results.map(result => result.jobId));

            jobs = await db.Job.findAll({
                where: {
                    actualStartTime: { [Op.not]: null },
                    actualEndTime: { [Op.not]: null },
                    id: { [Op.notIn]: processedJobIds }
                },
                include: [{
                    model: db.Line,
                    as: "line"
                }],
                transaction: localTransaction
            });
        }

        for (const job of jobs) {
            // Get all machines for this line using JobLineMachineTag
            const machineStates = await db.JobLineMachineTag.findAll({
                where: {
                    jobId: job.id,
                    lineId: job.lineId
                },
                attributes: [
                    "machineId",
                    "machineName",
                    "lineId",
                    "lineName"
                ],
                group: ["machineId"],
                transaction: localTransaction
            });

            for (const machineState of machineStates) {
                // Get the state tag for this machine
                const tag = await db.Tags.findOne({
                    where: {
                        taggableType: "machine",
                        taggableId: machineState.machineId,
                        ref: TagRefs.MACHINE_STATE
                    },
                    transaction: localTransaction
                });

                if (!tag) continue;

                // Get tag values between job start and end time
                const tagValues = await TagValues.findAll({
                    where: {
                        tagId: tag.id,
                        createdAt: {
                            [Op.between]: [job.actualStartTime, job.actualEndTime]
                        }
                    },
                    order: [["createdAt", "ASC"]],
                    transaction: localTransaction
                });

                if (tagValues.length < 2) continue;

                // Process state sequences
                let currentState = null;
                let stateStartTime = null;

                for (let i = 0; i < tagValues.length; i++) {
                    const currentValue = tagValues[i];
                    const nextValue = tagValues[i + 1];

                    if (currentState === null) {
                        currentState = currentValue.value;
                        stateStartTime = currentValue.createdAt;
                    }

                    // Check if state changes or if we're at the end
                    if (nextValue && nextValue.value !== currentState || !nextValue) {
                        const endTime = nextValue ? nextValue.createdAt : currentValue.createdAt;
                        const duration = dayjs(endTime).diff(dayjs(stateStartTime), "minute");

                        // Create aggregation record
                        await db.MachineStateAggregation.create({
                            jobId: job.id,
                            machineId: machineState.machineId,
                            machineName: machineState.machineName,
                            tagId: tag.id,
                            tagName: tag.name,
                            lineId: machineState.lineId,
                            lineName: machineState.lineName,
                            stateCode: parseInt(currentState),
                            stateName: getStateLabel(parseInt(currentState)),
                            stateStartDateTime: stateStartTime,
                            stateEndDateTime: endTime,
                            duration: duration,
                            processed: true
                        }, { transaction: localTransaction });

                        if (nextValue) {
                            currentState = nextValue.value;
                            stateStartTime = nextValue.createdAt;
                        }
                    }
                }
            }
        }

        // Only commit if we created the transaction
        if (!transaction && localTransaction) {
            await localTransaction.commit();
        }
        console.log("!!!!!!!!!!!!!!!!Machine state aggregation completed successfully !!!!!!!!!!!!!!!Machine state aggregation completed successfully!!!!!!!!!!!!!!!!!");
    } catch (error) {
        // Only rollback if we created the transaction
        if (!transaction && localTransaction) {
            await localTransaction.rollback();
        }
        console.error("Error aggregating machine states:", error);
        throw error; // Re-throw to let caller handle it
    }
}

// Cleanup old aggregations
async function cleanupOldAggregations() {
    try {
        // Find duplicate aggregations
        const duplicates = await db.MachineStateAggregation.findAll({
            attributes: [
                "jobId",
                "machineId",
                "stateStartDateTime",
                "stateEndDateTime",
                [sequelize.fn("COUNT", sequelize.col("id")), "count"]
            ],
            group: ["jobId", "machineId", "stateStartDateTime", "stateEndDateTime"],
            having: sequelize.literal("count > 1")
        });

        // Remove duplicates keeping the oldest record
        for (const duplicate of duplicates) {
            const records = await db.MachineStateAggregation.findAll({
                where: {
                    jobId: duplicate.jobId,
                    machineId: duplicate.machineId,
                    stateStartDateTime: duplicate.stateStartDateTime,
                    stateEndDateTime: duplicate.stateEndDateTime
                },
                order: [["createdAt", "ASC"]]
            });

            // Keep the first record, delete the rest
            for (let i = 1; i < records.length; i++) {
                await records[i].destroy();
            }
        }

        console.log("Cleanup completed successfully");
    } catch (error) {
        console.error("Error during cleanup:", error);
    }
}

// State mapping
const stateMap = {
    0: "No batch",
    1: "Stopped",
    2: "Starting",
    4: "Prepared",
    8: "Lack",
    16: "Tailback",
    32: "Lack branch line",
    64: "Tailback branch line",
    128: "Operating",
    256: "Stopping",
    512: "Aborting",
    1024: "Equipment failure",
    2048: "External failure",
    4096: "Emergency stopped",
    8192: "Holding",
    16384: "Held",
    32768: "Partial fault"
};


const getStateLabel = (stateCode) => {
    return stateMap[stateCode] || `Unknown State (${stateCode})`;
};

/**
 * SQL-based alarm aggregation (MUCH FASTER and more reliable)
 * Uses LEAD window function to detect alarm sequences
 */
async function aggregateAlarmsSQL(jobId, transaction = null) {
    console.log(`\n🚀 Starting SQL-based alarm aggregation for Job ${jobId}...`);
    
    try {
        // Get job details
        const job = await db.Job.findByPk(jobId, { transaction });
        if (!job) {
            throw new Error(`Job ${jobId} not found`);
        }
        
        if (!job.actualStartTime || !job.actualEndTime) {
            throw new Error(`Job ${jobId} missing actualStartTime or actualEndTime`);
        }
        
        console.log(`📅 Job Period: ${job.actualStartTime} to ${job.actualEndTime}`);
        console.log(`🏭 Line ID: ${job.lineId}`);
        
        // Step 1: Get all machines that have alarm tags
        console.log(`\n🔍 Step 1: Finding machines with alarm tags...`);
        const machinesWithAlarmsQuery = `
            SELECT DISTINCT
                t.taggableId as machineId,
                m.name as machineName
            FROM tags t
            JOIN Machines m ON m.id = t.taggableId
            WHERE t.ref = 'alarm'
              AND t.taggableType = 'machine'
        `;
        
        const machinesWithAlarms = await sequelize.query(machinesWithAlarmsQuery, {
            replacements: {},
            type: QueryTypes.SELECT,
            transaction
        });
        
        console.log(`✅ Found ${machinesWithAlarms.length} machines with alarm tags`);
        machinesWithAlarms.forEach(m => console.log(`   - Machine ${m.machineId}: ${m.machineName}`));
        
        if (machinesWithAlarms.length === 0) {
            console.log(`⚠️  No machines with alarm tags found for this line`);
            return;
        }
        
        // Step 1b: Check which machines actually qualify (OutputTotal > 0)
        console.log(`\n🔍 Step 1b: Checking which machines actually produced (OutputTotal > 0)...`);
        const qualifiedMachines = [];
        for (const machine of machinesWithAlarms) {
            // Try machine-level OutputTotal first
            let hasProduction = await sequelize.query(`
                SELECT COUNT(*) as count
                FROM tags t
                JOIN tagvalues tv ON tv.tagId = t.id
                WHERE t.name LIKE '%_OutputTotal'
                  AND t.taggableType = 'machine'
                  AND t.taggableId = :machineId
                  AND tv.createdAt BETWEEN :startTime AND :endTime
                  AND CAST(tv.value AS DECIMAL(20,2)) > 0
                LIMIT 1
            `, {
                replacements: {
                    machineId: machine.machineId,
                    startTime: job.actualStartTime,
                    endTime: job.actualEndTime
                },
                type: QueryTypes.SELECT,
                transaction
            });
            
            // If no machine-level, try line-level OutputTotal
            if (hasProduction[0].count === 0) {
                hasProduction = await sequelize.query(`
                    SELECT COUNT(*) as count
                    FROM tags t
                    JOIN tagvalues tv ON tv.tagId = t.id
                    WHERE t.name LIKE '%_OutputTotal'
                      AND t.taggableType = 'line'
                      AND t.taggableId = :lineId
                      AND tv.createdAt BETWEEN :startTime AND :endTime
                      AND CAST(tv.value AS DECIMAL(20,2)) > 0
                    LIMIT 1
                `, {
                    replacements: {
                        lineId: job.lineId,
                        startTime: job.actualStartTime,
                        endTime: job.actualEndTime
                    },
                    type: QueryTypes.SELECT,
                    transaction
                });
            }
            
            if (hasProduction[0].count > 0) {
                qualifiedMachines.push(machine);
                console.log(`   ✅ ${machine.machineName} (ID: ${machine.machineId}) - QUALIFIED`);
            } else {
                console.log(`   ❌ ${machine.machineName} (ID: ${machine.machineId}) - NO PRODUCTION`);
            }
        }
        
        if (qualifiedMachines.length === 0) {
            console.log(`\n⚠️  No machines qualified for Job ${jobId} (no production detected)`);
            return;
        }
        
        console.log(`\n✅ ${qualifiedMachines.length} machines qualified for alarm aggregation`);
        
        // Step 2: Get all alarm sequences for qualified machines using LEAD window function
        console.log(`\n🔍 Step 2: Detecting alarm sequences...`);
        const machineIds = qualifiedMachines.map(m => m.machineId);
        
        const alarmSequencesQuery = `
            WITH alarm_sequences AS (
                SELECT 
                    tv.tagId,
                    t.name as tagName,
                    t.taggableId as machineId,
                    tv.value as alarmCode,
                    tv.createdAt as alarmStart,
                    LEAD(tv.createdAt) OVER (PARTITION BY tv.tagId ORDER BY tv.createdAt) as alarmEnd,
                    LEAD(tv.value) OVER (PARTITION BY tv.tagId ORDER BY tv.createdAt) as nextAlarmCode
                FROM tagvalues tv
                JOIN tags t ON tv.tagId = t.id
                WHERE t.ref = 'alarm'
                  AND t.taggableType = 'machine'
                  AND t.taggableId IN (:machineIds)
                  AND tv.createdAt BETWEEN :startTime AND :endTime
                  AND tv.value != '0'
            )
            SELECT 
                tagId,
                tagName,
                machineId,
                alarmCode,
                alarmStart,
                alarmEnd,
                TIMESTAMPDIFF(MINUTE, alarmStart, alarmEnd) as durationMinutes
            FROM alarm_sequences
            WHERE alarmEnd IS NOT NULL
              AND nextAlarmCode != alarmCode
              AND TIMESTAMPDIFF(MINUTE, alarmStart, alarmEnd) >= 10
            ORDER BY machineId, alarmStart ASC
        `;
        
        const alarmSequences = await sequelize.query(alarmSequencesQuery, {
            replacements: {
                machineIds: machineIds,
                startTime: job.actualStartTime,
                endTime: job.actualEndTime
            },
            type: QueryTypes.SELECT,
            transaction
        });
        
        console.log(`✅ Found ${alarmSequences.length} qualifying alarm sequences (>= 10 min)`);
        
        // Step 3: Get line and machine names
        console.log(`\n🔍 Step 3: Enriching alarm data...`);
        
        // Get line name using Sequelize model (avoid reserved word issues)
        let lineName = null;
        if (job.lineId) {
            const lineQuery = `SELECT name FROM \`Lines\` WHERE id = ?`;
            const lineResult = await sequelize.query(lineQuery, {
                replacements: [job.lineId],
                type: QueryTypes.SELECT,
                transaction
            });
            lineName = lineResult.length > 0 ? lineResult[0].name : null;
        }
        
        // Get machine names
        const machineNamesQuery = `SELECT id, name FROM \`Machines\` WHERE id IN (?)`;
        const machineNamesResult = await sequelize.query(machineNamesQuery, {
            replacements: [machineIds],
            type: QueryTypes.SELECT,
            transaction
        });
        
        const machineNameMap = {};
        machineNamesResult.forEach(m => {
            machineNameMap[m.id] = m.name;
        });
        
        // Build alarms to save
        const alarmsToSave = alarmSequences.map(alarm => ({
            jobId: job.id,
            machineId: alarm.machineId,
            machineName: machineNameMap[alarm.machineId] || null,
            tagId: alarm.tagId,
            tagName: alarm.tagName,
            lineId: job.lineId,
            lineName: lineName,
            alarmCode: alarm.alarmCode,
            alarmStartDateTime: alarm.alarmStart,
            alarmEndDateTime: alarm.alarmEnd,
            duration: alarm.durationMinutes,
            processed: true
        }));
        
        // Step 4: Save all alarms to database
        console.log(`\n💾 Step 4: Saving ${alarmsToSave.length} alarms to database...`);
        
        if (alarmsToSave.length > 0) {
            await db.AlarmAggregation.bulkCreate(alarmsToSave, { transaction });
            console.log(`✅ Saved ${alarmsToSave.length} alarms successfully!`);
        } else {
            console.log(`⚠️  No alarms to save (all were < 10 minutes or filtered out)`);
        }
        
        // Summary by machine
        console.log(`\n📊 Summary by Machine:`);
        const summary = alarmsToSave.reduce((acc, alarm) => {
            const key = `${alarm.machineId}_${alarm.machineName}`;
            if (!acc[key]) {
                acc[key] = { machineId: alarm.machineId, machineName: alarm.machineName, count: 0 };
            }
            acc[key].count++;
            return acc;
        }, {});
        
        Object.values(summary).forEach(s => {
            console.log(`   ${s.machineName} (ID: ${s.machineId}): ${s.count} alarms`);
        });
        
        console.log(`\n✅ SQL-based alarm aggregation completed for Job ${jobId}!`);
        
    } catch (error) {
        console.error(`❌ Error during SQL-based alarm aggregation:`, error);
        throw error;
    }
}

module.exports = {
    aggregateAlarms,
    aggregateAlarmsSQL,
    aggregateMachineStates,
    cleanupOldAggregations,
    getStateLabel
};