const dayjs = require("dayjs");
const db = require("../dbInit");
const {
    TagValues,
    Op,
    sequelize,
} = require("../dbInit");

const { fn, col, literal } = require("sequelize");
const TagRefs = require("../utils/constants/TagRefs");



async function aggregateAlarms(specificJobId = null, transaction = null) {
    try {
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

            for (const machineTag of machineAlarmTags) {
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

                if (tagValues.length < 2) continue; // Skip if not enough values for a sequence

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

                        // Skip preform feeder alarms that run for more than 30 minutes
                        const isPreformFeeder = machineTag.machineName && 
                            (machineTag.machineName.toLowerCase().includes('preformfeeder') || 
                             machineTag.machineName.toLowerCase().includes('preform-feeder'));
                        const isLongRunningAlarm = durationMinutes > 30;
                        
                        if (isPreformFeeder && isLongRunningAlarm) {
                            console.log(`Skipping preform feeder alarm: ${machineTag.machineName} - Duration: ${durationMinutes.toFixed(2)} minutes`);
                            // Reset tracker if next value is 0, otherwise start new sequence
                            if (nextValue.value === "0") {
                                currentAlarm = null;
                                alarmStartTime = null;
                            } else {
                                currentAlarm = nextValue.value;
                                alarmStartTime = nextValue.createdAt;
                            }
                            continue;
                        }

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

                    // Skip preform feeder alarms that run for more than 30 minutes
                    const isPreformFeeder = machineTag.machineName && 
                        (machineTag.machineName.toLowerCase().includes('preformfeeder') || 
                         machineTag.machineName.toLowerCase().includes('preform-feeder'));
                    const isLongRunningAlarm = durationMinutes > 30;
                    
                    if (isPreformFeeder && isLongRunningAlarm) {
                        console.log(`Skipping preform feeder alarm (last sequence): ${machineTag.machineName} - Duration: ${durationMinutes.toFixed(2)} minutes`);
                    } else {
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
                    }
                }
            }
        }

        console.log("Alarm aggregation completed successfully");
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

module.exports = {
    aggregateAlarms,
    aggregateMachineStates,
    cleanupOldAggregations,
    getStateLabel
};