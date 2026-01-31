const dayjs = require("dayjs");
const db = require("../dbInit");
const {
    TagValues,
    Op,
    sequelize,
} = require("../dbInit");

const { fn, col, literal } = require("sequelize");
const TagRefs = require("../utils/constants/TagRefs");


/**
 * Helper function to check if a machine has started production
 * Checks if OutputTotal counter has increased since job start
 * Note: OutputTotal tags can be at machine level OR line level (e.g., Blower, Robopac)
 */
async function checkMachineQualification(machineId, job, transaction) {
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

        // ATTEMPT 2: If not found at machine level, check line level
        // Some machines (like Blower, Robopac) have OutputTotal at line level
        if (!outputTag) {
            outputTag = await db.Tags.findOne({
                where: {
                    taggableType: 'line',
                    taggableId: job.lineId,
                    name: { [Op.like]: '%_OutputTotal' }
                },
                transaction
            });

            if (outputTag) {
                console.log(`📍 Found OutputTotal tag at LINE level for machine ${machineId} (tag: ${outputTag.name})`);
            }
        } else {
            console.log(`📍 Found OutputTotal tag at MACHINE level for machine ${machineId} (tag: ${outputTag.name})`);
        }

        if (!outputTag) {
            console.log(`⚠️  No OutputTotal tag found for machine ${machineId} (checked both machine and line level)`);
            return false;
        }

        // Get first OutputTotal value at or after job start
        const firstValue = await db.TagValues.findOne({
            where: {
                tagId: outputTag.id,
                createdAt: { [Op.gte]: job.actualStartTime }
            },
            order: [['createdAt', 'ASC']],
            transaction
        });

        if (!firstValue) {
            console.log(`⚠️  No OutputTotal values found for machine ${machineId} after job start`);
            return false;
        }

        // Get second OutputTotal value (first change after start)
        const secondValue = await db.TagValues.findOne({
            where: {
                tagId: outputTag.id,
                createdAt: { [Op.gt]: firstValue.createdAt }
            },
            order: [['createdAt', 'ASC']],
            transaction
        });

        if (!secondValue) {
            console.log(`⚠️  No OutputTotal change detected for machine ${machineId}`);
            return false;
        }

        const outputDiff = parseFloat(secondValue.value) - parseFloat(firstValue.value);
        const isQualified = outputDiff > 0;

        console.log(`${isQualified ? '✅' : '❌'} Machine ${machineId} qualification: OutputTotal ${firstValue.value} → ${secondValue.value} (diff: ${outputDiff})`);

        return isQualified;
    } catch (error) {
        console.error(`Error checking qualification for machine ${machineId}:`, error);
        return false;
    }
}


/**
 * Helper function to detect if two alarms overlap
 */
function alarmsOverlap(alarm1, alarm2) {
    return alarm1.startTime < alarm2.endTime && alarm2.startTime < alarm1.endTime;
}

/**
 * Helper function to group alarms into sequences (overlapping alarms)
 */
function groupAlarmsIntoSequences(allAlarms) {
    if (allAlarms.length === 0) return [];

    // Sort by start time
    const sorted = [...allAlarms].sort((a, b) => a.startTime - b.startTime);

    const sequences = [];
    let currentSequence = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const alarm = sorted[i];
        const lastAlarmInSequence = currentSequence[currentSequence.length - 1];

        if (alarmsOverlap(lastAlarmInSequence, alarm)) {
            // Overlapping - add to current sequence
            currentSequence.push(alarm);
        } else {
            // No overlap - save current sequence and start new one
            sequences.push(currentSequence);
            currentSequence = [alarm];
        }
    }

    // Don't forget the last sequence
    if (currentSequence.length > 0) {
        sequences.push(currentSequence);
    }

    return sequences;
}

/**
 * Helper function to select winner from a sequence (earliest start time)
 */
function selectSequenceWinner(sequence) {
    if (sequence.length === 0) return null;
    if (sequence.length === 1) return sequence[0];

    // Return alarm with earliest start time
    return sequence.reduce((earliest, alarm) => {
        return alarm.startTime < earliest.startTime ? alarm : earliest;
    });
}

async function aggregateAlarms(specificJobId = null, transaction = null) {
    try {
        console.log('\n========================================');
        console.log('🚀 ALARM AGGREGATION WITH 5 PHASES STARTED');
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
            
            const machineQualified = {}; // { machineId: boolean }
            
            // Check qualification for each machine
            for (const machineTag of machineAlarmTags) {
                const isQualified = await checkMachineQualification(machineTag.machineId, job, transaction);
                machineQualified[machineTag.machineId] = isQualified;
            }

            console.log(`\nMachine Qualification Summary:`);
            Object.entries(machineQualified).forEach(([machineId, qualified]) => {
                console.log(`  Machine ${machineId}: ${qualified ? '✅ QUALIFIED' : '❌ NOT QUALIFIED'}`);
            });

            // ============================================================
            // PHASE 2: COLLECT QUALIFYING ALARMS (>= 10 min)
            // ============================================================
            console.log('\n--- PHASE 2: Collect Qualifying Alarms (>= 10 min) ---\n');

            const allAlarms = []; // Collect all qualifying alarms here

            // Process alarms for each machine
            for (const machineTag of machineAlarmTags) {
                // Skip non-qualified machines
                if (!machineQualified[machineTag.machineId]) {
                    console.log(`⏩ Skipping machine ${machineTag.machineName} (not qualified)`);
                    continue;
                }

                console.log(`\n🔍 Processing alarms for ${machineTag.machineName} (machineId: ${machineTag.machineId})`);

                // Get tag values between job start and end time
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

                if (tagValues.length < 2) {
                    console.log(`  ⚠️  Not enough tag values (${tagValues.length})`);
                    continue;
                }

                // Process alarm sequences
                let currentAlarm = null;
                let alarmStartTime = null;

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
                    }

                    // End of current alarm sequence (when next value is different)
                    if (currentAlarm !== null && nextValue.value !== currentAlarm) {
                        // Calculate duration in minutes
                        const startDate = new Date(alarmStartTime);
                        const endDate = new Date(nextValue.createdAt);
                        const durationMinutes = (endDate - startDate) / (1000 * 60);

                        // Only keep alarms >= 10 minutes
                        if (durationMinutes >= 10) {
                            console.log(`  ✅ Alarm #${currentAlarm}: ${durationMinutes.toFixed(2)} min (>= 10 min, added to collection)`);

                            allAlarms.push({
                                jobId: job.id,
                                machineId: machineTag.machineId,
                                machineName: machineTag.machineName,
                                tagId: machineTag.tagId,
                                tagName: machineTag.tagName,
                                lineId: machineTag.lineId,
                                lineName: machineTag.lineName,
                                alarmCode: currentAlarm,
                                startTime: new Date(alarmStartTime),
                                endTime: new Date(nextValue.createdAt),
                                duration: durationMinutes,
                            });
                        } else {
                            console.log(`  ⏩ Alarm #${currentAlarm}: ${durationMinutes.toFixed(2)} min (< 10 min, skipped)`);
                        }

                        // Reset tracker if next value is 0, otherwise start new sequence
                        if (nextValue.value === "0") {
                            currentAlarm = null;
                            alarmStartTime = null;
                        } else {
                            currentAlarm = nextValue.value;
                            alarmStartTime = nextValue.createdAt;
                        }
                    }
                }

                // Handle last alarm sequence if exists
                const lastValue = tagValues[tagValues.length - 1];
                if (currentAlarm !== null && lastValue.value === currentAlarm) {
                    // Calculate duration in minutes for the last sequence
                    const startDate = new Date(alarmStartTime);
                    const endDate = new Date(lastValue.createdAt);
                    const durationMinutes = (endDate - startDate) / (1000 * 60);

                    // Only keep alarms >= 10 minutes
                    if (durationMinutes >= 10) {
                        console.log(`  ✅ Alarm #${currentAlarm} (last): ${durationMinutes.toFixed(2)} min (>= 10 min, added to collection)`);

                        allAlarms.push({
                            jobId: job.id,
                            machineId: machineTag.machineId,
                            machineName: machineTag.machineName,
                            tagId: machineTag.tagId,
                            tagName: machineTag.tagName,
                            lineId: machineTag.lineId,
                            lineName: machineTag.lineName,
                            alarmCode: currentAlarm,
                            startTime: new Date(alarmStartTime),
                            endTime: new Date(lastValue.createdAt),
                            duration: durationMinutes,
                        });
                    } else {
                        console.log(`  ⏩ Alarm #${currentAlarm} (last): ${durationMinutes.toFixed(2)} min (< 10 min, skipped)`);
                    }
                }
            }

            console.log(`\n📊 Total qualifying alarms collected: ${allAlarms.length}`);

            // ============================================================
            // PHASE 3: GROUP INTO SEQUENCES (Overlapping Alarms)
            // ============================================================
            console.log('\n--- PHASE 3: Group Overlapping Alarms into Sequences ---');
            
            const sequences = groupAlarmsIntoSequences(allAlarms);
            
            console.log(`📦 Total sequences: ${sequences.length}`);
            sequences.forEach((seq, idx) => {
                console.log(`\nSequence ${idx + 1}: ${seq.length} alarm(s)`);
                seq.forEach(alarm => {
                    console.log(`  - ${alarm.machineName} Alarm #${alarm.alarmCode}: ${alarm.startTime.toISOString()} - ${alarm.endTime.toISOString()} (${alarm.duration.toFixed(2)} min)`);
                });
            });

            // ============================================================
            // PHASE 4: SELECT WINNER FROM EACH SEQUENCE
            // ============================================================
            console.log('\n--- PHASE 4: Select Winner (Earliest Start) from Each Sequence ---');
            
            const winnersToRecord = [];
            
            sequences.forEach((sequence, idx) => {
                const winner = selectSequenceWinner(sequence);
                if (winner) {
                    winnersToRecord.push(winner);
                    console.log(`\n🏆 Sequence ${idx + 1} Winner: ${winner.machineName} Alarm #${winner.alarmCode}`);
                    console.log(`   Start: ${winner.startTime.toISOString()}, Duration: ${winner.duration.toFixed(2)} min`);
                }
            });

            console.log(`\n📝 Total alarms to record: ${winnersToRecord.length}`);

            // ============================================================
            // PHASE 5: CREATE ALARM AGGREGATION RECORDS
            // ============================================================
            console.log('\n--- PHASE 5: Create AlarmAggregation Records ---');
            
            for (const alarm of winnersToRecord) {
                const createOptions = {
                    jobId: alarm.jobId,
                    machineId: alarm.machineId,
                    machineName: alarm.machineName,
                    tagId: alarm.tagId,
                    tagName: alarm.tagName,
                    lineId: alarm.lineId,
                    lineName: alarm.lineName,
                    alarmCode: alarm.alarmCode,
                    alarmStartDateTime: alarm.startTime,
                    alarmEndDateTime: alarm.endTime,
                    duration: alarm.duration,
                    processed: true,
                };
                
                const createQueryOptions = {};
                if (transaction) createQueryOptions.transaction = transaction;

                await db.AlarmAggregation.create(createOptions, createQueryOptions);
                
                console.log(`✅ Created: ${alarm.machineName} Alarm #${alarm.alarmCode} (${alarm.duration.toFixed(2)} min)`);
            }

            console.log(`\n✅ Job ${job.id} alarm aggregation completed!`);
        }

        console.log('\n========================================');
        console.log('✅ ALARM AGGREGATION COMPLETED SUCCESSFULLY');
        console.log('========================================\n');
    } catch (error) {
        console.error('\n========================================');
        console.error('❌ ERROR IN ALARM AGGREGATION');
        console.error('========================================');
        console.error("Error aggregating alarms:", error);
        console.error('Stack trace:', error.stack);
        console.error('========================================\n');
        throw error;
    }
}


async function aggregateMachineStates(specificJobId = null, transaction = null) {
    let localTransaction = transaction;
    try {
        // If no transaction provided, create a new one
        if (!transaction) {
            localTransaction = await sequelize.transaction();
        }

        let jobs;

        if (specificJobId) {
            // Process specific job
            jobs = await db.Job.findAll({
                where: {
                    id: specificJobId,
                    actualStartTime: { [Op.not]: null },
                    actualEndTime: { [Op.not]: null }
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

module.exports = {
    aggregateAlarms,
    aggregateMachineStates,
    cleanupOldAggregations,
    getStateLabel
};