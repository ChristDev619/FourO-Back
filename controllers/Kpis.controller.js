const dayjs = require("dayjs");
const minMax = require("dayjs/plugin/minMax");
dayjs.extend(minMax);
const { Job, Tags, TagValues, Op, Program, LineMachine, AlarmAggregation , Sku , LineRecipie , Recipie, DesignSpeed } = require("../dbInit");
const TagRefs = require("../utils/constants/TagRefs");
const { mergeOverlappingBreakdowns } = require("./report.utils.js");
// Global variables to cache fetched values
let productCount = null;
let lostValue = null;
let productPlanned = null;
let batchDuration = null;
let got = null;
let not = null;
let slt = null;

async function getTimeTypeDuration(machineId, jobId, timeType) {
    try {
        // Fetch job
        const job = await Job.findByPk(jobId);
        if (!job) {
            throw new Error("Job not found");
        }

        // Use UTC times directly
        const startTime = dayjs(job.actualStartTime).utc();
        const endTime = dayjs(job.actualEndTime).utc();

        // Fetch tag
        const tag = await Tags.findOne({
            where: { taggableType: "machine", taggableId: machineId, ref: TagRefs.MACHINE_STATE },
        });

        if (!tag) {
            throw new Error("Tag not found");
        }

        // Fetch tag values
        const tagValues = await TagValues.findAll({
            where: {
                tagId: tag.id,
                createdAt: { [Op.between]: [startTime.toDate(), endTime.toDate()] },
            },
            order: [["createdAt", "ASC"]],
        });

        let totalDuration = 0;
        let currentSequence = [];
        let allSequences = [];

        // console.log("\nMatching values found:");
        // console.log("Time (UTC)\t\tValue");
        // console.log("--------------------------------");

        // Process values
        for (let i = 0; i < tagValues.length; i++) {
            const currentValue = tagValues[i];
            const nextValue = tagValues[i + 1];

            const currentNumValue = parseInt(currentValue.value);

            if (currentNumValue === timeType) {
                const utcTime = dayjs(currentValue.createdAt).utc();
                // console.log(
                //   `${utcTime.format("MM/DD/YY HH:mm")}\t${currentValue.value}`
                // );

                // Add to current sequence
                currentSequence.push({
                    timestamp: utcTime.format("MM/DD/YY HH:mm"),
                    value: currentNumValue,
                    createdAt: currentValue.createdAt,
                });

                // Check for sequence end
                const isEndOfSequence =
                    !nextValue ||
                    parseInt(nextValue.value) !== timeType ||
                    dayjs(nextValue.createdAt).diff(currentValue.createdAt, "minute") > 1;

                if (isEndOfSequence && currentSequence.length > 0) {
                    const sequence = {
                        points: currentSequence,
                        duration: currentSequence.length,
                        startTime: currentSequence[0].timestamp,
                        endTime: currentSequence[currentSequence.length - 1].timestamp,
                    };

                    allSequences.push(sequence);
                    totalDuration += sequence.duration;
                    currentSequence = [];
                }
            }
        }

        // Log results
        // console.log("\nSequences found:");
        // allSequences.forEach((seq, index) => {
        //   console.log(`\nSequence #${index + 1}:`);
        //   console.log(`Time (UTC): ${seq.startTime} to ${seq.endTime}`);
        //   console.log(`Duration: ${seq.duration} minutes`);
        // });

        // console.log(`\n=== Final Duration: ${totalDuration} minutes ===`);

        return totalDuration;
    } catch (error) {
        console.error("Error in getTimeTypeDuration:", error);
        throw error;
    }
}

async function fetchProductCountUntil(lineId, jobId) {
    try {
        const job = await Job.findByPk(jobId);
        if (!job) throw new Error("Job not found");

        const tag = await Tags.findOne({
            where: { taggableType: "line", taggableId: lineId, ref: TagRefs.BOTTLES_COUNT },
        });

        if (!tag) throw new Error("Bottle Count (bc) tag not found");

        const jobStart = dayjs(job.actualStartTime);
        const endTime = dayjs(job.actualEndTime);

        const [valueAtStart, valueAtEnd] = await Promise.all([
            TagValues.findOne({
                where: {
                    tagId: tag.id,
                    createdAt: { [Op.lte]: jobStart.toDate() },
                },
                order: [["createdAt", "DESC"]],
            }),
            TagValues.findOne({
                where: {
                    tagId: tag.id,
                    createdAt: { [Op.lte]: endTime.toDate() },
                },
                order: [["createdAt", "DESC"]],
            }),
        ]);

        if (!valueAtEnd) return 0;

        if (!valueAtStart || jobStart.isSame(endTime, "minute")) {
            return Math.round(valueAtEnd.value);
        }

        return Math.round(valueAtEnd.value - valueAtStart.value);
    } catch (error) {
        console.error("Error in fetchProductCountUntil:", error.message);
        return 0;
    }
}

// Fetch Lost Value
async function fetchLostValue(lineId, jobId) {
    console.error("lineId", lineId);

    // if (lostValue !== null) return lostValue; // Return cached value if it exists

    try {
        const tag = await Tags.findOne({
            where: { taggableId: lineId, ref: TagRefs.REJECTED_BOTTLES },
        });
        if (!tag) throw new Error("Lost tag not found");

        const job = await Job.findByPk(jobId);
        if (!job) throw new Error("Job not found");

        // Fetch the first and last tag values between the job's start and end times
        const [firstValue, lastValue] = await Promise.all([
            TagValues.findOne({
                where: { tagId: tag.id, createdAt: { [Op.gte]: job.actualStartTime } },
                order: [["createdAt", "ASC"]],
            }),
            TagValues.findOne({
                where: { tagId: tag.id, createdAt: { [Op.lte]: job.actualEndTime } },
                order: [["createdAt", "DESC"]],
            }),
        ]);

        if (!firstValue || !lastValue) {
            lostValue = 0; // No data within the range, assume 0 lost value
        } else {
            lostValue = lastValue.value - firstValue.value;
        }
        return lostValue;
    } catch (error) {
        console.error("Error fetching lost value:", error);
        throw error;
    }
}

// Fetch Batch Duration
async function fetchBatchDuration(jobId) {//christ to check to make it only 1 call , need performance enhancement
    // if (batchDuration !== null) return batchDuration; // Return cached value if it exists

    try {
        const job = await Job.findByPk(jobId);
        if (!job) throw new Error("Job not found");

        // Calculate duration in minutes
        batchDuration = dayjs(job.actualEndTime).diff(
            dayjs(job.actualStartTime),
            "minute"
        );
        return batchDuration;
    } catch (error) {
        console.error("Error fetching batch duration:", error);
        throw error;
    }
}

async function calculateVOT(jobId, lineId, netProduction = null) {
  // Use netProduction if provided, otherwise fallback to fetchProductCountUntil (fillerCounter) for backward compatibility
  const productCount = netProduction !== null ? netProduction : await fetchProductCountUntil(lineId, jobId);
  const designSpeed = await fetchDesignSpeed(lineId, jobId);
  console.log(`\n========== VOT CALCULATION ==========`);
  console.log(`JobId: ${jobId}, LineId: ${lineId}`);
  console.log(`Product Count (${netProduction !== null ? 'netProduction' : 'fillerCounter'}): ${productCount} bottles`);
  console.log(`Design Speed: ${designSpeed} bottles/min`);
  console.log(`Design Speed (per hour): ${designSpeed * 60} bottles/hour`);
  const vot = designSpeed ? productCount / (designSpeed / 60) : 0;
  console.log(`VOT Calculation: ${productCount} / (${designSpeed} / 60) = ${vot} minutes`);
  console.log(`========== VOT CALCULATION END ==========\n`);
  return vot;
}

async function calculateVOTProgram(jobId, lineId, ProgramDuration, netProduction = null) {
  // Use netProduction if provided, otherwise fallback to fetchProductCountUntil (fillerCounter) for backward compatibility
  const productCount = netProduction !== null ? netProduction : await fetchProductCountUntil(lineId, jobId);
  const designSpeed = await fetchDesignSpeed(lineId, jobId);
  return designSpeed ? productCount / (designSpeed / 60) : 0;
}

async function calculateQL(lineId, jobId) {
    const lostValue = await fetchLostValue(lineId, jobId);
    const productCount = await fetchProductCountUntil(lineId, jobId);
    
    // Handle division by zero case (no production)
    if (productCount === 0) {
        return 0; // No production means no quality loss
    }
    
    return (lostValue / productCount) * 100;
}

async function calculateNOT(lineId, jobId, netProduction = null) {
    const vot = await calculateVOT(jobId, lineId, netProduction);
    const ql = await calculateQL(lineId, jobId);
    return vot + ql;
}

async function calculateTotalBreakdownTimeForLine(jobId) {
    // Fetch the job for its line and batch window
    const job = await Job.findByPk(jobId);
    if (!job) throw new Error("Job not found");

    // Get all machine IDs for this line
    const lineMachines = await LineMachine.findAll({ where: { lineId: job.lineId } });
    const machineIds = lineMachines.map(lm => lm.machineId).filter(Boolean);

    // Fetch all relevant breakdown alarms from alarmaggregations for all machines in this job window
    const alarms = await AlarmAggregation.findAll({
        where: {
            jobId: job.id,
            machineId: { [Op.in]: machineIds },
            duration: { [Op.gte]: 5 },
        },
        order: [["alarmStartDateTime", "ASC"]],
    });

    // Format alarms for merging (convert to the format expected by mergeOverlappingBreakdowns)
    const formattedAlarms = alarms.map(alarm => ({
        id: alarm.id,
        machineId: alarm.machineId,
        machineName: alarm.machineName,
        alarmCode: alarm.alarmCode,
        startDateTime: alarm.alarmStartDateTime,
        endDateTime: alarm.alarmEndDateTime,
        duration: alarm.duration,
        alarmReasonName: alarm.alarmReasonName,
        alarmNote: alarm.alarmNote
    }));

    // Merge overlapping breakdowns to avoid double counting
    const mergedBreakdowns = mergeOverlappingBreakdowns(formattedAlarms);
    
    // Calculate total breakdown time from merged breakdowns
    let totalBreakdown = 0;
    for (const breakdown of mergedBreakdowns) {
        const breakdownDuration = dayjs(breakdown.endDateTime).diff(dayjs(breakdown.startDateTime), 'minute');
        totalBreakdown += breakdownDuration;
    }

    return totalBreakdown;
}
 
async function calculateUDT(machineId, jobId) {
    const stoppedTime = await getTimeTypeDuration(machineId, jobId, 1);
    const equipmentFailureTime = await getTimeTypeDuration(
        machineId, 
        jobId, 
        1024
    );
    return stoppedTime + equipmentFailureTime;
}

async function calculateGOT(jobId, machineId) {
    const batchDuration = await fetchBatchDuration(jobId);
    //const udt = await calculateUDT(machineId, jobId);// OLD
    const udt = await calculateTotalBreakdownTimeForLine(jobId); // NEW
    return batchDuration - udt;
}

async function calculateSLT(jobId, machineId, lineId) {
    got = await calculateGOT(jobId, machineId);
    not = await calculateNOT(lineId, jobId);

    return got - not;
}

async function calculateSL(jobId, machineId, lineId) {
    const slt = await calculateSLT(jobId, machineId, lineId);

    const tailbackTime = await getTimeTypeDuration(machineId, jobId, 16); // Tailback Time
    const lackTime = await getTimeTypeDuration(machineId, jobId, 8); // Lack Time

    return slt - tailbackTime - lackTime;
}

async function calculateMetrics(jobId, machineId, lineId, netProduction = null) {
    console.log(`\n========== CALCULATE METRICS START ==========`);
    console.log(`Job ID: ${jobId}, Machine ID: ${machineId}, Line ID: ${lineId}`);
    if (netProduction !== null) {
        console.log(`Using netProduction: ${netProduction} bottles (instead of fillerCounter)`);
    }
    
    const vot = await calculateVOT(jobId, lineId, netProduction);
    const ql = await calculateQL(lineId, jobId);
    const not = await calculateNOT(lineId, jobId, netProduction);
    //const udt = await calculateUDT(machineId, jobId); OLD
    const udt = await calculateTotalBreakdownTimeForLine(jobId); // NEW
    const got = await calculateGOT(jobId, machineId);
    const slt = await calculateSLT(jobId, machineId, lineId);
    const sl = await calculateSL(jobId, machineId, lineId);
    const batchDuration = await fetchBatchDuration(jobId);
    
    const netEfficiency = batchDuration > 0 ? (vot / batchDuration) * 100 : 0;
    
    console.log(`\n--- FINAL METRICS SUMMARY ---`);
    console.log(`VOT (Value Operating Time): ${vot} minutes`);
    console.log(`Batch Duration: ${batchDuration} minutes`);
    console.log(`NET EFFICIENCY: ${netEfficiency.toFixed(2)}%`);
    console.log(`Quality Loss (QL): ${ql} minutes`);
    console.log(`NOT (Net Operating Time): ${not} minutes`);
    console.log(`UDT (Unscheduled Downtime): ${udt} minutes`);
    console.log(`GOT (Gross Operating Time): ${got} minutes`);
    console.log(`SLT (Speed Loss Time): ${slt} minutes`);
    console.log(`SL (Speed Loss): ${sl} minutes`);
    console.log(`========== CALCULATE METRICS END ==========\n`);
    
    return { vot, ql, not, udt, got, slt, sl,batchDuration };
}

async function calculateTrueEfficiency(programId, jobId, lineId, vot = null, netProduction = null) {
    try {

        const program = await Program.findByPk(programId);

        const job = await Job.findByPk(jobId);

        if (!program || !job) throw new Error("Missing program or job");

        if (!program.startDate || !program.endDate) {
            throw new Error("Program startDate or endDate is missing");
        }

        const jobStart = dayjs(job.actualStartTime);
        const jobEnd = dayjs(job.actualEndTime);

        const progStart = dayjs(program.startDate);
        const progEnd = dayjs(program.endDate);

        if (progEnd.isBefore(progStart)) {
            return {
                valueOperatingTime: 0,
                productionTime: 0,
                programDuration: 0,
                trueEfficiency: 0,
            };
        }
         
        const productionTime = jobEnd.diff(jobStart, "minute");
        const programDuration = progEnd.diff(progStart, "minute");

        // Pass netProduction to calculateVOTProgram so VOT uses netProduction instead of fillerCounter
        const votProgram = await calculateVOTProgram(jobId, lineId, productionTime, netProduction);//for now we used the batch duration 

        valueOperatingTime = votProgram;

        const trueEfficiency =
            programDuration > 0
                ? parseFloat(((valueOperatingTime / programDuration) * 100).toFixed(2))
                : 0;

        return {
            valueOperatingTime,
            productionTime,
            programDuration,
            trueEfficiency,
        };
    } catch (error) {
        console.error("Error in calculateTrueEfficiency:", error);
        return {
            valueOperatingTime: 0,
            productionTime: 0,
            programDuration: 0,
            trueEfficiency: 0,
        };
    }
}

// Same mergeIntervals util as before
function mergeIntervals(intervals) {
    if (!intervals.length) return [];
    intervals.sort((a, b) => a.start - b.start);
    const merged = [];
    let last = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
        const curr = intervals[i];
        if (curr.start <= last.end) {
            last.end = new Date(Math.max(last.end, curr.end));
        } else {
            merged.push(last);
            last = curr;
        }
    }
    merged.push(last);
    return merged;
}
async function calculateUDTIntervals(machineId, jobId) {
    const stoppedIntervals = await getTimeTypeIntervals(machineId, jobId, 1);
    const failureIntervals = await getTimeTypeIntervals(machineId, jobId, 1024);
    return [...stoppedIntervals, ...failureIntervals];
}


// Helper to get all intervals (start, end) for a machine, job, and timeType
async function getTimeTypeIntervals(machineId, jobId, timeType) {
    try {
      

        const job = await Job.findByPk(jobId);
        if (!job) throw new Error("Job not found");

        const startTime = dayjs(job.actualStartTime).utc();
        const endTime = dayjs(job.actualEndTime).utc();

        const tag = await Tags.findOne({
            where: { taggableType: "machine", taggableId: machineId, ref: TagRefs.MACHINE_STATE },
        });

        if (!tag) throw new Error("Tag not found");

        const tagValues = await TagValues.findAll({
            where: {
                tagId: tag.id,
                createdAt: { [Op.between]: [startTime.toDate(), endTime.toDate()] },
            },
            order: [["createdAt", "ASC"]],
        });

        let currentSequence = [];
        let allIntervals = [];

        for (let i = 0; i < tagValues.length; i++) {
            const currentValue = tagValues[i];
            const nextValue = tagValues[i + 1];
            const currentNumValue = parseInt(currentValue.value);

            if (currentNumValue === timeType) {
                currentSequence.push(currentValue);

                const isEndOfSequence =
                    !nextValue ||
                    parseInt(nextValue.value) !== timeType ||
                    dayjs(nextValue.createdAt).diff(currentValue.createdAt, "minute") > 1;

                if (isEndOfSequence && currentSequence.length > 0) {
                    allIntervals.push({
                        start: new Date(currentSequence[0].createdAt),
                        end: new Date(currentSequence[currentSequence.length - 1].createdAt)
                    });
                    currentSequence = [];
                }
            }
        }

        return allIntervals;
    } catch (error) {
        console.error("Error in getTimeTypeIntervals:", error);
        throw error;
    }
}

async function fetchDesignSpeed(lineId, jobId) {
    console.log(`\n========== FETCH DESIGN SPEED DEBUG START ==========`);
    console.log(`Job ID: ${jobId}, Line ID: ${lineId}`);
    
    const job = await Job.findByPk(jobId);
    if (!job) throw new Error("Job not found");
    
    console.log(`Job Details:`, {
        id: job.id,
        skuId: job.skuId,
        lineId: job.lineId,
        actualStartTime: job.actualStartTime
    });

    // ===== NEW FIX: Use SKU-based lookup first (most reliable) =====
    if (job.skuId) {
        console.log(`\n--- PRIMARY METHOD: SKU-Based Lookup (Job.skuId = ${job.skuId}) ---`);
        
        const skuBasedLineRecipe = await LineRecipie.findOne({
            where: { lineId },
            include: [
                {
                    model: Recipie,
                    as: 'recipie',
                    where: { skuId: job.skuId },
                    include: [
                        {
                            model: Sku,
                            as: 'sku'
                        }
                    ]
                },
                {
                    model: DesignSpeed,
                    as: 'designSpeed'
                }
            ]
        });
        
        if (skuBasedLineRecipe && skuBasedLineRecipe.designSpeed) {
            const designSpeedValue = parseFloat(skuBasedLineRecipe.designSpeed.value) || 0;
            console.log(`✅ SUCCESS: Found design speed using SKU-based lookup`);
            console.log(`Design Speed Details:`, {
                method: 'SKU-Based (job.skuId)',
                lineRecipeId: skuBasedLineRecipe.id,
                recipieId: skuBasedLineRecipe.recipieId,
                recipieName: skuBasedLineRecipe.recipie?.name || 'N/A',
                skuId: job.skuId,
                skuName: skuBasedLineRecipe.recipie?.sku?.name || 'N/A',
                designSpeedId: skuBasedLineRecipe.designSpeed.id,
                designSpeedValue: designSpeedValue
            });
            console.log(`========== FETCH DESIGN SPEED DEBUG END ==========\n`);
            return designSpeedValue;
        } else {
            console.log(`⚠️ SKU-based lookup found no result, falling back to tag-based method...`);
        }
    } else {
        console.log(`⚠️ Job has no skuId, using tag-based fallback method...`);
    }

    // ===== FALLBACK METHOD: Recipe tag-based lookup =====
    console.log(`\n--- FALLBACK METHOD: Tag-Based Lookup ---`);
    
    const recipeTag = await Tags.findOne({ where: { taggableId: lineId, ref: TagRefs.RECIPE } });
    if (!recipeTag) {
        console.log(`❌ Recipe tag not found`);
        console.log(`========== FETCH DESIGN SPEED DEBUG END ==========\n`);
        return 0;
    }
    
    console.log(`Recipe Tag Found:`, { id: recipeTag.id, name: recipeTag.name, ref: recipeTag.ref });

    const recipeValue = await TagValues.findOne({
        where: { tagId: recipeTag.id, createdAt: { [Op.lte]: job.actualStartTime } },
        order: [["createdAt", "DESC"]],
    });
    
    console.log(`Recipe Tag Value:`, recipeValue ? {
        value: recipeValue.value,
        createdAt: recipeValue.createdAt
    } : 'NOT FOUND');

    const recipeName = recipeValue?.value?.trim();
    if (!recipeName) {
        console.log(`❌ No recipe name found in tag values`);
        console.log(`========== FETCH DESIGN SPEED DEBUG END ==========\n`);
        return 0;
    }
    
    console.log(`Recipe Name from Tag: "${recipeName}"`);
    
    const lineRecipe = await LineRecipie.findOne({
        where: { lineId },
        include: [
            {
                model: Recipie,
                as: 'recipie',
                include: [
                    {
                        model: Sku,
                        as: 'sku',
                        where: { name: recipeName }
                    }
                ]
            },
            {
                model: DesignSpeed,
                as: 'designSpeed'
            }
        ]
    });

    if (!lineRecipe || !lineRecipe.designSpeed) {
        console.log(`❌ No design speed found using tag-based fallback method`);
        console.log(`========== FETCH DESIGN SPEED DEBUG END ==========\n`);
        return 0;
    }

    const designSpeedValue = parseFloat(lineRecipe.designSpeed.value) || 0;
    console.log(`⚠️ USING FALLBACK: Design Speed from tag-based lookup:`, {
        method: 'Tag-Based (recipe name)',
        lineRecipeId: lineRecipe.id,
        recipieName: lineRecipe.recipie?.name || 'N/A',
        skuName: lineRecipe.recipie?.sku?.name || 'N/A',
        designSpeedValue: designSpeedValue,
        warning: 'This may be incorrect if multiple SKUs share the same name'
    });
    
    console.log(`========== FETCH DESIGN SPEED DEBUG END ==========\n`);
    return designSpeedValue;
}

module.exports = {
    fetchBatchDuration,
    calculateMetrics,
    calculateGOT,
    calculateNOT,
    calculateQL,
    calculateSL,
    calculateSLT,
    calculateUDT,
    calculateVOT,
    getTimeTypeDuration,
    calculateTrueEfficiency,
};
