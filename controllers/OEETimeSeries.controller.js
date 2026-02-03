const dayjs = require("dayjs");
const isSameOrBefore = require("dayjs/plugin/isSameOrBefore");
dayjs.extend(isSameOrBefore);
const isSameOrAfter = require("dayjs/plugin/isSameOrAfter");
dayjs.extend(isSameOrAfter);
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
const { Job, Tags, TagValues, Op, Sku } = require("../dbInit");
const TagRefs = require("../utils/constants/TagRefs");
const { getDesignSpeedForJob } = require("../utils/helpers/designSpeedHelper");
//const fs = require("fs");

// Cache for frequently accessed data
const cache = {
    tags: {},
    jobs: {},
    tagValues: {}
};

// --- UTILITY: Get batch start value (virtual zero) ---
async function getBatchStartValue(tagId, batchStartTime) {
    const cacheKey = `batchstart_${tagId}_${batchStartTime}`;
    if (cache.tagValues[cacheKey]) return cache.tagValues[cacheKey];

    // Fetch the earliest tagvalue at or after batch/job start
    const firstRecord = await TagValues.findOne({
        where: {
            tagId,
            createdAt: {
                [Op.gte]: new Date(batchStartTime)
            }
        },
        order: [["createdAt", "ASC"]],
    });
    const startValue = firstRecord ? parseInt(firstRecord.value) : 0;
    cache.tagValues[cacheKey] = startValue;
    return startValue;
}

async function getTimeTypeDurationWithTimeBounds(machineId, jobId, timeType, startTime, endTime, machineStateTagValues) {
    try {
        // machineStateTagValues: array of TagValue objects for MACHINE_STATE tag, sorted by createdAt ASC
        // startTime, endTime: Date or dayjs
        if (!machineStateTagValues || machineStateTagValues.length === 0) return 0;
        // Filter tag values within the specific time range
        const tagValues = machineStateTagValues.filter(tv => {
            const t = dayjs(tv.createdAt);
            return t.isSameOrAfter(startTime) && t.isSameOrBefore(endTime);
        });
        let totalDuration = 0;
        let currentSequence = [];
        let allSequences = [];
        for (let i = 0; i < tagValues.length; i++) {
            const currentValue = tagValues[i];
            const nextValue = tagValues[i + 1];
            const currentNumValue = parseInt(currentValue.value);
            if (currentNumValue === timeType) {
                const utcTime = dayjs(currentValue.createdAt).utc();
                currentSequence.push({
                    timestamp: utcTime.format("MM/DD/YY HH:mm"),
                    value: currentNumValue,
                    createdAt: currentValue.createdAt,
                });
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
        return totalDuration;
    } catch (error) {
        console.error("Error in getTimeTypeDurationWithTimeBounds (in-memory):", error);
        throw error;
    }
}

// Fetch Lost Value up to a specific time
async function fetchLostValueUntil(lineId, jobId, endTime, lostTagValues, jobStartTime) {
    try {
        // lostTagValues: array of TagValue objects for REJECTED_BOTTLES tag, sorted by createdAt ASC
        // jobStartTime: Date or dayjs
        // endTime: Date or dayjs
        if (!lostTagValues || lostTagValues.length === 0) return 0;
        // Find first value at or before jobStartTime
        let firstValue = null;
        for (let i = lostTagValues.length - 1; i >= 0; i--) {
            if (dayjs(lostTagValues[i].createdAt).isSameOrBefore(jobStartTime)) {
                firstValue = lostTagValues[i];
                break;
            }
        }
        // Find last value at or before endTime
        let lastValue = null;
        for (let i = lostTagValues.length - 1; i >= 0; i--) {
            if (dayjs(lostTagValues[i].createdAt).isSameOrBefore(endTime)) {
                lastValue = lostTagValues[i];
                break;
            }
        }
        if (!firstValue || !lastValue) return 0;
        return lastValue.value - firstValue.value;
    } catch (error) {
        console.error("Error fetching lost value until (in-memory):", error);
        throw error;
    }
}

// Fetch Batch Duration between specified times
async function fetchBatchDurationBetween(startTime, endTime) {
    try {
        return dayjs(endTime).diff(dayjs(startTime), "minute");
    } catch (error) {
        console.error("Error fetching batch duration:", error);
        throw error;
    }
}

// Patch here: productCount = currentValue, but use "relative" value
async function calculateVOTUntil(currentValue,designSpeed) {
    const productCount = currentValue;
    const valueRecipDesignSpeed = designSpeed / 60;
    
    // Log if division by zero would occur
    if (valueRecipDesignSpeed === 0 || designSpeed <= 0) {
        console.error(`  ❌ VOT Calculation Error: Division by zero! designSpeed=${designSpeed}, valueRecipDesignSpeed=${valueRecipDesignSpeed}`);
        return NaN; // Return NaN to indicate error
    }
    
    const vot = productCount / valueRecipDesignSpeed;
    
    // Log if result is invalid
    if (!isFinite(vot) || isNaN(vot)) {
        console.error(`  ❌ VOT Calculation Error: Result is ${vot} (productCount=${productCount}, valueRecipDesignSpeed=${valueRecipDesignSpeed})`);
    }
    
    return vot;
    //return ((productCount - lostValue) / productPlanned) * batchDuration;
}

async function calculateQLUntil(lineId, jobId, startTime, endTime, currentValue, lostTagValues, jobStartTime) {
    const lostValue = await fetchLostValueUntil(lineId, jobId, endTime, lostTagValues, jobStartTime);
    const productCount = currentValue;

    if (productCount === 0) return 0;
    return (lostValue / productCount) * 100;
}

async function calculateNOTUntil(lineId, jobId, startTime, endTime, currentValue, designSpeed, lostTagValues, jobStartTime) {
    const vot = await calculateVOTUntil(currentValue, designSpeed);
    const ql = await calculateQLUntil(lineId, jobId, startTime, endTime, currentValue, lostTagValues, jobStartTime);
    return vot + ql;
}

async function calculateUDTUntil(machineId, jobId, startTime, endTime, machineStateTagValues) {
    const stoppedTime = await getTimeTypeDurationWithTimeBounds(machineId, jobId, 1, startTime, endTime, machineStateTagValues);
    const equipmentFailureTime = await getTimeTypeDurationWithTimeBounds(machineId, jobId, 1024, startTime, endTime, machineStateTagValues);
    return stoppedTime + equipmentFailureTime;
}

async function calculateGOTUntil(jobId, machineId, startTime, endTime, machineStateTagValues) {
    const batchDuration = await fetchBatchDurationBetween(startTime, endTime);
    const udt = await calculateUDTUntil(machineId, jobId, startTime, endTime, machineStateTagValues);
    return batchDuration - udt;
}

async function calculateSLTUntil(jobId, machineId, lineId, startTime, endTime, currentValue, designSpeed, lostTagValues, machineStateTagValues, jobStartTime) {
    const got = await calculateGOTUntil(jobId, machineId, startTime, endTime, machineStateTagValues);
    const not = await calculateNOTUntil(lineId, jobId, startTime, endTime, currentValue, designSpeed, lostTagValues, jobStartTime);
    return got - not;
}

async function calculateSLUntil(jobId, machineId, lineId, startTime, endTime, currentValue, designSpeed, lostTagValues, machineStateTagValues, jobStartTime) {
    const slt = await calculateSLTUntil(jobId, machineId, lineId, startTime, endTime, currentValue, designSpeed, lostTagValues, machineStateTagValues, jobStartTime);
    const tailbackTime = await getTimeTypeDurationWithTimeBounds(machineId, jobId, 16, startTime, endTime, machineStateTagValues);
    const lackTime = await getTimeTypeDurationWithTimeBounds(machineId, jobId, 8, startTime, endTime, machineStateTagValues);
    return slt - tailbackTime - lackTime;
}

async function calculateMetricsUntil(jobId, machineId, lineId, startTime, endTime, currentValue, designSpeed, lostTagValues, machineStateTagValues) {
    const lostValue = await fetchLostValueUntil(lineId, jobId, endTime, lostTagValues, startTime);
    const productCount = currentValue;
    const batchDuration = await fetchBatchDurationBetween(startTime, endTime);

    const vot = await calculateVOTUntil(productCount, designSpeed);
    const ql = await calculateQLUntil(lineId, jobId, startTime, endTime, productCount, lostTagValues, startTime);
    const not = await calculateNOTUntil(lineId, jobId, startTime, endTime, productCount, designSpeed, lostTagValues, startTime);
    const udt = await calculateUDTUntil(machineId, jobId, startTime, endTime, machineStateTagValues);
    const got = await calculateGOTUntil(jobId, machineId, startTime, endTime, machineStateTagValues);
    const slt = await calculateSLTUntil(jobId, machineId, lineId, startTime, endTime, productCount, designSpeed, lostTagValues, machineStateTagValues, startTime);
    const sl = await calculateSLUntil(jobId, machineId, lineId, startTime, endTime, productCount, designSpeed, lostTagValues, machineStateTagValues, startTime);

    return { vot, ql, not, udt, got, slt, sl, batchDuration };
}

async function getMachineStateSequences(machineId, startTime, endTime) {
    try {
        const cacheKey = `tag_machine_${machineId}_mchnst`;
        let tag = cache.tags[cacheKey];

        if (!tag) {
            tag = await Tags.findOne({
                where: { taggableType: "machine", taggableId: machineId, ref: TagRefs.MACHINE_STATE },
            });
            if (tag) cache.tags[cacheKey] = tag;
        }

        if (!tag) throw new Error("Machine state tag not found");

        const tagValuesCacheKey = `tagvalues_${tag.id}_${startTime.toISOString()}_${endTime.toISOString()}`;
        let tagValues = cache.tagValues[tagValuesCacheKey];

        if (!tagValues) {
            tagValues = await TagValues.findAll({
                where: {
                    tagId: tag.id,
                    createdAt: { [Op.between]: [startTime, endTime] },
                },
                order: [["createdAt", "ASC"]],
            });
            cache.tagValues[tagValuesCacheKey] = tagValues;
        }

        if (tagValues.length === 0) return [];

        const sequences = [];
        let currentState = tagValues[0].value;
        let sequenceStartTime = tagValues[0].createdAt;

        for (let i = 1; i < tagValues.length; i++) {
            const currentValue = tagValues[i];

            if (currentValue.value !== currentState) {
                const previousTimestamp = tagValues[i - 1].createdAt;

                sequences.push({
                    state: currentState,
                    startTime: sequenceStartTime,
                    endTime: previousTimestamp,
                    duration: dayjs(currentValue.createdAt).diff(dayjs(sequenceStartTime), "minute"),
                });

                currentState = currentValue.value;
                sequenceStartTime = currentValue.createdAt;
            }

            if (i === tagValues.length - 1) {
                sequences.push({
                    state: currentState,
                    startTime: sequenceStartTime,
                    endTime: currentValue.createdAt,
                    duration: dayjs(currentValue.createdAt).diff(dayjs(sequenceStartTime), "minute"),
                });
            }
        }

        return sequences;
    } catch (error) {
        console.error("Error getting machine state sequences:", error);
        throw error;
    }
}

// --- MAIN PATCHED FUNCTION ---
    async function calculateOEETimeSeries(job, machineId, lineId, sampleInterval = 1) {
  try {
    // Get design speed using job's SKU (most reliable method)
    const designSpeedDB = await getDesignSpeedForJob(job, lineId);

    // Log initial setup for debugging
    console.log(`\n=== OEE CURVE CALCULATION START ===`);
    console.log(`Job ID: ${job?.id}`);
    console.log(`Job SKU ID: ${job.skuId || 'N/A'}`);
    console.log(`Line ID: ${lineId}`);
    console.log(`Machine ID: ${machineId}`);
    console.log(`Design Speed: ${designSpeedDB} bottles/min`);
    if (designSpeedDB <= 0) {
      console.warn(`⚠️  WARNING: Design Speed is ${designSpeedDB} - this will cause division by zero!`);
    }

    if (!job) throw new Error("Job not found");

    const jobStart = dayjs.utc(job.actualStartTime);
    const jobEnd = dayjs.utc(job.actualEndTime);
    const jobId = job.id; // you'll still need this in downstream calls

    // Fetch SKU once to get numberOfContainersPerPack
    let numberOfContainersPerPack = 0;
    if (job.skuId) {
      const sku = await Sku.findByPk(job.skuId);
      if (sku && sku.numberOfContainersPerPack) {
        numberOfContainersPerPack = sku.numberOfContainersPerPack;
      }
    }

    // Get tag for production counter with intelligent fallback (csct → bc)
    let tag = null;
    let tagCacheKey = null;
    let productionCounterType = null; // Track which type we're using
    
    // ATTEMPT 1: Try CASE_COUNT first (standard - e.g., Krones lines)
    tagCacheKey = `tag_line_${lineId}_csct`;
    tag = cache.tags[tagCacheKey];
    
    if (!tag) {
      tag = await Tags.findOne({
        where: { taggableType: "line", taggableId: lineId, ref: TagRefs.CASE_COUNT },
      });
      if (tag) {
        cache.tags[tagCacheKey] = tag;
        productionCounterType = 'csct';
        console.log(`✓ OEE Curve [Line ${lineId}]: Using CASE_COUNT (csct) tag`);
      }
    } else {
      productionCounterType = 'csct';
      console.log(`✓ OEE Curve [Line ${lineId}]: Using cached CASE_COUNT (csct) tag`);
    }
    
    // ATTEMPT 2: Fallback to BOTTLE_COUNT if CASE_COUNT not found (e.g., Bardi lines)
    if (!tag) {
      tagCacheKey = `tag_line_${lineId}_bc`;
      tag = cache.tags[tagCacheKey];
      
      if (!tag) {
        tag = await Tags.findOne({
          where: { taggableType: "line", taggableId: lineId, ref: TagRefs.BOTTLES_COUNT },
        });
        if (tag) {
          cache.tags[tagCacheKey] = tag;
          productionCounterType = 'bc';
          console.log(`✓ OEE Curve [Line ${lineId}]: Using BOTTLE_COUNT (bc) fallback tag`);
        }
      } else {
        productionCounterType = 'bc';
        console.log(`✓ OEE Curve [Line ${lineId}]: Using cached BOTTLE_COUNT (bc) fallback tag`);
      }
    }

    if (!tag) throw new Error(`Production counter tag not found for line ${lineId}. Expected CASE_COUNT (csct) or BOTTLE_COUNT (bc).`);

    // Fetch production counter tag values (tagValues) before using it
    const tagValuesCacheKey = `tagvalues_${tag.id}_${jobStart.toISOString()}_${jobEnd.toISOString()}`;
    let tagValues = cache.tagValues[tagValuesCacheKey];
    if (!tagValues) {
      tagValues = await TagValues.findAll({
        where: {
          tagId: tag.id,
          createdAt: {
            [Op.gte]: jobStart.startOf('minute').toDate(),
            [Op.lte]: jobEnd.endOf('minute').toDate(),
          },
        },
        order: [["createdAt", "ASC"]],
      });
      cache.tagValues[tagValuesCacheKey] = tagValues;
    }
    if (tagValues.length === 0) throw new Error(`No ${productionCounterType} tag values found for the job period.`);

    // Prefetch all tag values for the job period (case count already done)
    // Fetch lostTagValues (REJECTED_BOTTLES)
    const lostTagCacheKey = `tag_line_${lineId}_lost`;
    let lostTag = cache.tags[lostTagCacheKey];
    if (!lostTag) {
      lostTag = await Tags.findOne({
        where: { taggableId: lineId, ref: TagRefs.REJECTED_BOTTLES },
      });
      if (lostTag) cache.tags[lostTagCacheKey] = lostTag;
    }
    let lostTagValues = [];
    if (lostTag) {
      const lostTagValuesCacheKey = `tagvalues_${lostTag.id}_${jobStart.toISOString()}_${jobEnd.toISOString()}`;
      lostTagValues = cache.tagValues[lostTagValuesCacheKey];
      if (!lostTagValues) {
        lostTagValues = await TagValues.findAll({
          where: {
            tagId: lostTag.id,
            createdAt: {
              [Op.gte]: jobStart.startOf('minute').toDate(),
              [Op.lte]: jobEnd.endOf('minute').toDate(),
            },
          },
          order: [["createdAt", "ASC"]],
        });
        cache.tagValues[lostTagValuesCacheKey] = lostTagValues;
      }
    }
    // Fetch machineStateTagValues (MACHINE_STATE)
    const machineStateTagCacheKey = `tag_machine_${machineId}_mchnst`;
    let machineStateTag = cache.tags[machineStateTagCacheKey];
    if (!machineStateTag) {
      machineStateTag = await Tags.findOne({
        where: { taggableType: "machine", taggableId: machineId, ref: TagRefs.MACHINE_STATE },
      });
      if (machineStateTag) cache.tags[machineStateTagCacheKey] = machineStateTag;
    }
    let machineStateTagValues = [];
    if (machineStateTag) {
      const machineStateTagValuesCacheKey = `tagvalues_${machineStateTag.id}_${jobStart.toISOString()}_${jobEnd.toISOString()}`;
      machineStateTagValues = cache.tagValues[machineStateTagValuesCacheKey];
      if (!machineStateTagValues) {
        machineStateTagValues = await TagValues.findAll({
          where: {
            tagId: machineStateTag.id,
            createdAt: {
              [Op.gte]: jobStart.startOf('minute').toDate(),
              [Op.lte]: jobEnd.endOf('minute').toDate(),
            },
          },
          order: [["createdAt", "ASC"]],
        });
        cache.tagValues[machineStateTagValuesCacheKey] = machineStateTagValues;
      }
    }

    // --- Use same logic as report: first value >= job start (to match getTagValuesDifference exactly)
    // Use the same Date object format as report (job.actualStartTime directly, not UTC converted)
    const firstTagValue = await TagValues.findOne({
      where: {
        tagId: tag.id,
        createdAt: { [Op.gte]: job.actualStartTime },
      },
      order: [["createdAt", "ASC"]],
    });

    if (!firstTagValue) {
      throw new Error("First tag value not found for case count");
    }
    const batchStartValue = parseInt(firstTagValue.value);

    // Get last tag value <= job end (to match report's getTagValuesDifference exactly)
    // Use the same Date object format as report (job.actualEndTime directly, not UTC converted)
    const lastTagValue = await TagValues.findOne({
      where: {
        tagId: tag.id,
        createdAt: { [Op.lte]: job.actualEndTime },
      },
      order: [["createdAt", "DESC"]],
    });

    if (!lastTagValue) {
      throw new Error("Last tag value not found for case count");
    }
    const lastTagValueNumber = parseInt(lastTagValue.value);

    // Calculate the exact total net production based on counter type
    let totalNetProduction = 0;
    let totalCaseCount = 0;
    
    if (productionCounterType === 'csct') {
      // CASE_COUNT: Calculate cases, then multiply by containers per pack
      totalCaseCount = lastTagValueNumber - batchStartValue;
      totalNetProduction = totalCaseCount * numberOfContainersPerPack;
      
      console.log(`\n--- Initial Values (CASE_COUNT Mode) ---`);
      console.log(`First Case Count Value: ${batchStartValue}`);
      console.log(`Last Case Count Value: ${lastTagValueNumber}`);
      console.log(`Case Count Difference: ${totalCaseCount}`);
      console.log(`Number of Containers Per Pack: ${numberOfContainersPerPack}`);
      console.log(`Total Net Production: ${totalNetProduction} bottles`);
      
      if (totalCaseCount < 0) {
        console.error(`❌ ERROR: Negative case count difference! Counter reset detected.`);
      }
    } else if (productionCounterType === 'bc') {
      // BOTTLE_COUNT: Use directly (already in bottles)
      totalNetProduction = lastTagValueNumber - batchStartValue;
      totalCaseCount = 0; // Not applicable for direct bottle counting
      
      console.log(`\n--- Initial Values (BOTTLE_COUNT Mode) ---`);
      console.log(`First Bottle Count Value: ${batchStartValue}`);
      console.log(`Last Bottle Count Value: ${lastTagValueNumber}`);
      console.log(`Bottle Count Difference: ${totalNetProduction}`);
      console.log(`Total Net Production: ${totalNetProduction} bottles (direct)`);
      console.log(`Note: Using direct bottle counter - no case conversion needed`);
      
      if (totalNetProduction < 0) {
        console.error(`❌ ERROR: Negative bottle count difference! Counter reset detected.`);
      }
    }
    console.log(`\n--- Processing Minutes ---`);

    // Main loop: generate minute timestamps first
    const minuteTimestamps = [];
    let currentTime = dayjs(jobStart);
    const endMinute = dayjs(jobEnd);
    while (currentTime.isSameOrBefore(endMinute)) {
      minuteTimestamps.push(currentTime.clone());
      currentTime = currentTime.add(sampleInterval, 'minute');
    }
    
    console.log(`Processing ${minuteTimestamps.length} time points with ${sampleInterval}-minute intervals`);
    
    // Build minuteValueMap based on the actual timestamps that will be used
    // This ensures perfect alignment between map keys and actual processing
    const minuteValueMap = new Map();
    
    // Find the index of firstTagValue in the tagValues array
    let tagIdx = tagValues.findIndex(tv => 
      dayjs(tv.createdAt).isSameOrAfter(job.actualStartTime)
    );
    if (tagIdx === -1) tagIdx = 0;
    
    let lastSeenValue = batchStartValue; // Start with the same value as report
    
    // For each timestamp that will be processed, find the corresponding tag value
    for (let i = 0; i < minuteTimestamps.length; i++) {
      const timestamp = minuteTimestamps[i];
      const isLastTimestamp = (i === minuteTimestamps.length - 1);
      
      if (isLastTimestamp) {
        // For the last timestamp, use the exact lastTagValueNumber that the report uses
        lastSeenValue = lastTagValueNumber;
      } else {
        // Advance tagIdx to the latest tag value at or before this timestamp
        while (
          tagIdx + 1 < tagValues.length &&
          dayjs(tagValues[tagIdx + 1].createdAt).isSameOrBefore(timestamp)
        ) {
          tagIdx++;
          lastSeenValue = parseInt(tagValues[tagIdx].value);
        }
      }
      
      minuteValueMap.set(timestamp.toISOString(), lastSeenValue);
    }

    const jobStartDate = jobStart.toDate();
    const jobEndDate = jobEnd.toDate();

    // Process in optimized batches for better performance
    const oeeTimeSeries = [];
    const BATCH_SIZE = 100; // Increased batch size for better performance
    
    // Get the actual last timestamp to ensure we use the correct last value
    const lastTimestamp = minuteTimestamps[minuteTimestamps.length - 1];
    
    console.log(`Processing ${minuteTimestamps.length} time points in batches of ${BATCH_SIZE}`);
    
    for (let i = 0; i < minuteTimestamps.length; i += BATCH_SIZE) {
      const batch = minuteTimestamps.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(minuteTimestamps.length/BATCH_SIZE)} (${batch.length} items)`);
      
      const batchResults = await Promise.all(
        batch.map(async (minute) => {
          const minuteKey = minute.toISOString();
          const minuteIndex = minuteTimestamps.findIndex(m => m.toISOString() === minuteKey) + 1;
          const minuteLabel = `Minute ${minuteIndex}/${minuteTimestamps.length}`;
          
          // Get the production counter value at this minute
          const lastSeenValueForMinute = minuteValueMap.has(minuteKey)
            ? minuteValueMap.get(minuteKey)
            : batchStartValue;
          
          // Calculate net production based on counter type
          let currentValue = 0;
          let caseCount = 0;
          
          if (productionCounterType === 'csct') {
            // CASE_COUNT: Calculate cases, then multiply by containers per pack
            caseCount = lastSeenValueForMinute - batchStartValue;
            currentValue = caseCount * numberOfContainersPerPack;
          } else if (productionCounterType === 'bc') {
            // BOTTLE_COUNT: Use directly (already in bottles)
            currentValue = lastSeenValueForMinute - batchStartValue;
          }
          
          // Validation checks
          let isValid = true;
          const validationErrors = [];
          
          if (designSpeedDB <= 0) {
            isValid = false;
            validationErrors.push(`Design Speed is ${designSpeedDB} (must be > 0)`);
            console.error(`  ❌ SKIPPED: ${validationErrors.join(', ')}`);
          }
          
          if (currentValue < 0) {
            isValid = false;
            validationErrors.push(`Negative bottle count: ${currentValue}`);
            console.warn(`  ⚠️  WARNING: Negative bottle count detected (possible counter reset)`);
            console.error(`  ❌ SKIPPED: ${validationErrors.join(', ')}`);
          }
          
          if (!isValid) {
            return null; // Skip this minute
          }
          
          const metrics = await calculateMetricsUntil(
            jobId,
            machineId,
            lineId,
            jobStartDate,
            minute.endOf("minute").toDate(),
            currentValue,
            designSpeedDB,
            lostTagValues,
            machineStateTagValues
          );

          // Log metrics
          console.log(`  Metrics:`);
          console.log(`    VOT: ${metrics.vot.toFixed(2)} min`);
          console.log(`    QL: ${metrics.ql.toFixed(2)} min`);
          console.log(`    NOT: ${metrics.not.toFixed(2)} min`);
          console.log(`    UDT: ${metrics.udt.toFixed(2)} min`);
          console.log(`    GOT: ${metrics.got.toFixed(2)} min`);
          console.log(`    Batch Duration: ${metrics.batchDuration.toFixed(2)} min`);

          // Additional validation after metrics calculation
          if (!isFinite(metrics.vot) || isNaN(metrics.vot)) {
            isValid = false;
            validationErrors.push(`VOT is ${metrics.vot} (NaN/Infinity)`);
            console.error(`  ❌ SKIPPED: ${validationErrors.join(', ')}`);
          }
          
          if (metrics.vot < 0) {
            isValid = false;
            validationErrors.push(`Negative VOT: ${metrics.vot}`);
            console.warn(`  ⚠️  WARNING: Negative VOT detected`);
            console.error(`  ❌ SKIPPED: ${validationErrors.join(', ')}`);
          }
          
          if (!isValid) {
            return null; // Skip this minute
          }

          const availability = metrics.batchDuration > 0 ? (metrics.got / metrics.batchDuration) * 100 : 0;
          const performance = metrics.got > 0 ? (metrics.not / metrics.got) * 100 : 0;
          const quality = metrics.not > 0 ? (metrics.vot / metrics.not) * 100 : 0;
          const oee = (availability * performance * quality) / 10000;

          // Log OEE components
          console.log(`  OEE Components:`);
          console.log(`    Availability: ${availability.toFixed(2)}%`);
          console.log(`    Performance: ${performance.toFixed(2)}%`);
          console.log(`    Quality: ${quality.toFixed(2)}%`);
          console.log(`    OEE: ${oee.toFixed(2)}%`);
          
          // Final validation
          if (!isFinite(oee) || isNaN(oee) || oee < 0) {
            console.error(`  ❌ SKIPPED: Invalid OEE value (${oee})`);
            return null;
          }
          
          console.log(`  ✓ VALID - Stored`);

          return {
            timestamp: minute.toISOString(),
            state: currentValue,
            stateName: getStateLabel(currentValue),
            duration: sampleInterval,
            metrics,
            oee: parseFloat(oee.toFixed(2)),
            availability: parseFloat(availability.toFixed(2)),
            performance: parseFloat(performance.toFixed(2)),
            quality: parseFloat(quality.toFixed(2)),
          };
        })
      );
      
      // Filter out null values (skipped minutes)
      const validResults = batchResults.filter(result => result !== null);
      const skippedCount = batchResults.length - validResults.length;
      
      if (skippedCount > 0) {
        console.warn(`\n⚠️  Batch ${Math.floor(i/BATCH_SIZE) + 1}: ${skippedCount} minute(s) skipped due to invalid data`);
      }
      
      oeeTimeSeries.push(...validResults);
      
      // No delay needed with optimized batch size
    }

    // Ensure the result is sorted by timestamp ascending (in case Promise.all returns out of order)
    oeeTimeSeries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Final summary log
    const totalMinutes = minuteTimestamps.length;
    const validMinutes = oeeTimeSeries.length;
    const skippedMinutes = totalMinutes - validMinutes;
    
    console.log(`\n=== OEE CURVE CALCULATION SUMMARY ===`);
    console.log(`Production Counter Type: ${productionCounterType.toUpperCase()}`);
    console.log(`Total Minutes Processed: ${totalMinutes}`);
    console.log(`Valid Minutes Stored: ${validMinutes}`);
    console.log(`Skipped Minutes: ${skippedMinutes}`);
    if (skippedMinutes > 0) {
      console.warn(`⚠️  ${skippedMinutes} minute(s) were skipped due to invalid data (negative values, zero designSpeed, etc.)`);
    }
    console.log(`=== END OEE CURVE CALCULATION ===\n`);

    return oeeTimeSeries;
  } catch (error) {
    console.error("Error calculating OEE time series:", error);
    throw error;
  }
}
 
async function getCachedJob(jobId) {
  const cacheKey = `job_${jobId}`;
  if (!cache.jobs[cacheKey]) {
    const job = await Job.findByPk(jobId);
    if (!job) throw new Error("Job not found");
    cache.jobs[cacheKey] = job;
  }
  return cache.jobs[cacheKey];
}

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
    32768: "Partial fault",
};

const getStateLabel = (stateCode) => {
    return stateMap[stateCode] || `Unknown State (${stateCode})`;
};

module.exports = {
    calculateMetricsUntil,
    calculateOEETimeSeries,
    getTimeTypeDurationWithTimeBounds,
    fetchLostValueUntil,
    fetchBatchDurationBetween,
    calculateVOTUntil,
    calculateQLUntil,
    calculateNOTUntil,
    calculateUDTUntil,
    calculateGOTUntil,
    calculateSLTUntil,
    calculateSLUntil,
    getMachineStateSequences,
    getStateLabel,
    getBatchStartValue // In case you want to reuse elsewhere
};
