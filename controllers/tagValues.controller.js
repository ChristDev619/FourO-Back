const { TagValues, Job, Program, Line, Recipie, Tags, sequelize, Op } = require("../dbInit");
const moment = require("moment");
// Lazy load queue to avoid connection issues during startup
let recalculationQueue = null;
const getRecalculationQueue = () => {
  if (!recalculationQueue) {
    recalculationQueue = require("../utils/queues/recalculationQueue");
  }
  return recalculationQueue;
};
const { recalculateAggregatesForJob } = require("../utils/modules");

// Helper function to handle recalculation - unified queue approach
async function handleRecalculation(jobId, transaction = null) {
    console.log(`🔍 DEBUG: handleRecalculation called for jobId: ${jobId}`);
    
    try {
        // Use Bull queue for both local and Azure environments
        console.log(`🔄 Adding job ${jobId} to recalculation queue`);
        const queue = getRecalculationQueue();
        console.log(`🔍 DEBUG: Queue obtained successfully`);
        const job = await queue.add({ jobId });
        console.log(`🔍 DEBUG: Job added to queue with ID: ${job.id}`);
        return job;
    } catch (error) {
        console.error(`❌ Error adding job to queue:`, error);
        throw error;
    }
}

const XLSX = require("xlsx");
const fs = require("fs");
const { QueryTypes } = require("sequelize");
const { tagSubscriptionService } = require("../utils/modules");
const TagRefs = require("../utils/constants/TagRefs");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

exports.createTagValue = async (req, res) => {
    const transaction = await sequelize.transaction();
    const jobsForRecalculation = []; // Track jobs that need recalculation
    try {
        const { tagId, value } = req.body;

        const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");
        const utcNow = moment.utc().format("YYMMDDHHmm");

        const tagValue = await TagValues.create({
            tagId,
            value,
            createdAt: currentTime,
            updatedAt: currentTime
        }, { transaction });

        const tag = await Tags.findByPk(tagId, { transaction });
        if (!tag) throw new Error("Tag not found");

        // Validate type
        if ((tag.ref === TagRefs.BATCH_ACTIVE || tag.ref === TagRefs.CURRENT_PROGRAM) && tag.taggableType !== "line") {
            throw new Error(`Tag with ref '${tag.ref}' must be linked to a line. Found type: '${tag.taggableType}'`);
        }

        if (tag.ref === TagRefs.BATCH_ACTIVE) {
            const lineId = tag.taggableId;

            if (value === 1) {
                const existingOpenJob = await Job.findOne({
                    where: { actualEndTime: null, lineId },
                    order: [['actualStartTime', 'DESC']],
                    transaction,
                });

                if (!existingOpenJob) {
                    const activeProgram = await Program.findOne({
                        where: { endDate: null },
                        order: [['startDate', 'DESC']],
                        transaction,
                    });

                    if (!activeProgram) {
                        throw new Error("Cannot start a job: No active program found.");
                    }

                    const line = await Line.findByPk(lineId, { attributes: ['name'], transaction });
                    const lineName = line?.name || `Line_${lineId}`;
                    const jobName = `${lineName}.Run_${utcNow}`;

                    await Job.create({
                        jobName,
                        actualStartTime: currentTime,
                        actualEndTime: null,
                        lineId,
                        programId: activeProgram.id,
                    }, { transaction });
                }
            } else if (value === 0) {
                const openJob = await Job.findOne({
                    where: { actualEndTime: null, lineId },
                    order: [['actualStartTime', 'DESC']],
                    transaction
                });

                if (openJob) {
                    await openJob.update({ actualEndTime: currentTime }, { transaction });

                    const recipeTag = await Tags.findOne({
                        where: {
                            ref: TagRefs.RECIPE,
                            taggableType: 'line',
                            taggableId: openJob.lineId
                        },
                        transaction
                    });

                    if (recipeTag) {
                        const latestRecipeTagVal = await TagValues.findOne({
                            where: {
                                tagId: recipeTag.id,
                                createdAt: { [Op.lte]: currentTime }
                            },
                            order: [['createdAt', 'DESC']],
                            transaction
                        });

                        if (latestRecipeTagVal) {
                            const recipeNumber = parseInt(latestRecipeTagVal.value);

                            const recipe = await sequelize.query(
                                `SELECT id, skuId FROM recipes WHERE number = :recipeNumber LIMIT 1`,
                                {
                                    replacements: { recipeNumber },
                                    type: QueryTypes.SELECT,
                                    transaction
                                }
                            );

                            if (recipe.length > 0 && recipe[0].skuId) {
                                await openJob.update({ skuId: recipe[0].skuId }, { transaction });
                            }
                        }
                    }
                    
                  // Track job for recalculation outside transaction
                  jobsForRecalculation.push(openJob.id);

                }
            }

        } else if (tag.ref === TagRefs.CURRENT_PROGRAM) {
            const lineId = tag.taggableId;

            if (value === 1) {
                const existingProgram = await Program.findOne({
                    where: { endDate: null },
                    transaction,
                });

                if (!existingProgram) {

                    const line = await Line.findByPk(lineId, {
                        attributes: ['name'],
                        transaction
                    });

                    const lineName = line?.name || `Line_${lineId}`;

                    const programName = `${lineName}_${utcNow}`;

                    await Program.create({
                        number: programName,
                        programName,
                        description: `Started by tag ${tag.id}`,
                        startDate: currentTime,
                        endDate: null,
                        lineId,
                    }, { transaction });
                }

            } else if (value === 0) {
                const openProgram = await Program.findOne({
                    where: { endDate: null },
                    order: [['startDate', 'DESC']],
                    transaction,
                });

                if (openProgram) {
                    await openProgram.update({ endDate: currentTime }, { transaction });
                }
            }
        }

        await transaction.commit();
        
        // Trigger recalculation for affected jobs outside transaction
        if (jobsForRecalculation.length > 0) {
            console.log(`🔄 Triggering recalculation for ${jobsForRecalculation.length} jobs after tag value creation`);
            const recalculationPromises = jobsForRecalculation.map(jobId => 
                handleRecalculation(jobId).catch(err => 
                    console.error(`❌ Failed to queue recalculation for job ${jobId}:`, err.message)
                )
            );
            await Promise.allSettled(recalculationPromises);
        }
        
        // Notify subscribers about the new tag value
        tagSubscriptionService.notifySubscribers(tagId, value, currentTime);
        res.status(201).json({
            message: "Tag value created successfully",
            tagValue: { tagId, value, createdAt: currentTime }
        });

    } catch (error) {
        await transaction.rollback();
        console.error("Error creating tag value:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getTagValueById = async (req, res) => {
  try {
    const tagValue = await TagValues.findByPk(req.params.id);
    if (!tagValue) {
      return res.status(404).send({ message: "TagValue not found" });
    }
    res.send(tagValue);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateTagValue = async (req, res) => {
  try {
    const result = await TagValues.update(req.body, {
      where: { id: req.params.id },
    });
    if (result == 0) {
      return res.status(404).send({ message: "TagValue not found" });
    }
    res.send({ message: "TagValue updated successfully" });
  } catch (error) {
    res.status(400).send(error);
  }
};
 
exports.updateTagValuesInRange = async (req, res) => {
    const { tagId, startDateTime, endDateTime, state } = req.body;
    const transaction = await sequelize.transaction();

    try {
        if (
            !tagId ||
            !startDateTime ||
            !endDateTime ||
            typeof state === "undefined"
        ) {
            await transaction.rollback();
            return res.status(400).json({ message: "Missing required parameters." });
        }

        // Parse dates directly (NO normalization to :00 seconds or ms)
        const parseDate = (str) => new Date(str);
        const start = parseDate(startDateTime);
        const end = parseDate(endDateTime);

        // STEP 1: Find affected jobs that overlap with this time range
        const affectedJobs = await Job.findAll({
            where: {
                [Op.and]: [
                    {
                        actualStartTime: {
                            [Op.lte]: end // Job started before or during our update period
                        }
                    },
                    {
                        [Op.or]: [
                            { actualEndTime: null }, // Job is still running
                            {
                                actualEndTime: {
                                    [Op.gte]: start // Job ended after our update period started
                                }
                            }
                        ]
                    }
                ]
            },
            attributes: ['id', 'actualStartTime', 'actualEndTime'],
            transaction
        });

        // STEP 2: Get the tag to check if it's a machine state tag
        const tag = await Tags.findByPk(tagId, {
            attributes: ['id', 'ref', 'taggableType', 'taggableId'],
            transaction
        });

        if (!tag) {
            await transaction.rollback();
            return res.status(404).json({ message: "Tag not found." });
        }

        // STEP 3: Update all TagValues in the range to the new state (inclusive of end)
        const [updatedRows] = await TagValues.update(
            { value: state },
            {
                where: {
                    tagId: tagId,
                    createdAt: {
                        [Op.gte]: start,
                        [Op.lte]: end, // INCLUSIVE
                    },
                },
                transaction
            }
        );

        // STEP 4: Find existing values in this range (minute-level dedupe)
        const existingTagValues = await TagValues.findAll({
            where: {
                tagId: tagId,
                createdAt: {
                    [Op.gte]: start,
                    [Op.lte]: end,
                },
            },
            transaction
        });

        // Build set of 'YYYY-MM-DD HH:mm' for fast lookup
        const existingMinuteSet = new Set(
            existingTagValues.map(tv => {
                const d = new Date(tv.createdAt);
                return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate() + " " + d.getUTCHours() + ":" + d.getUTCMinutes();
            })
        );

        // STEP 5: Fill in missing minutes (INCLUSIVE: while t <= end)
        let inserts = [];
        let t = new Date(start);
        while (t <= end) {
            const key = t.getUTCFullYear() + "-" + (t.getUTCMonth() + 1) + "-" + t.getUTCDate() + " " + t.getUTCHours() + ":" + t.getUTCMinutes();
            if (!existingMinuteSet.has(key)) {
                inserts.push({
                    tagId: tagId,
                    value: state,
                    createdAt: new Date(t),
                });
            }
            t.setMinutes(t.getMinutes() + 1);
        }
        if (inserts.length > 0) {
            await TagValues.bulkCreate(inserts, { transaction });
        }

                // STEP 6: Recalculate aggregations for affected jobs
        // Only recalculate if this is a machine state tag (not batch active or program tags)
        const isStateTag = tag.ref !== TagRefs.BATCH_ACTIVE && tag.ref !== TagRefs.CURRENT_PROGRAM;
        
        console.log(`🔍 DEBUG: Tag ref = "${tag.ref}", isStateTag = ${isStateTag}`);
        console.log(`🔍 DEBUG: Found ${affectedJobs.length} affected jobs`);
        console.log(`🔍 DEBUG: Time range: ${start} to ${end}`);
        
        if (affectedJobs.length > 0) {
            console.log(`🔍 DEBUG: Affected job IDs:`, affectedJobs.map(j => j.id));
        }

        await transaction.commit();

        // Trigger recalculation for affected jobs outside transaction
        if (isStateTag && affectedJobs.length > 0) {
            console.log(`🔄 Recalculating aggregates for ${affectedJobs.length} affected jobs due to tag ${tagId} state change...`);

            const recalculationPromises = affectedJobs.map(job => 
                handleRecalculation(job.id).catch(err => 
                    console.error(`❌ Failed to queue recalculation for job ${job.id}:`, err.message)
                )
            );
            
            await Promise.allSettled(recalculationPromises);
            console.log(`✅ Queued recalculation for ${affectedJobs.length} jobs`);
        } else {
            console.log(`⚠️  Skipping recalculation: isStateTag=${isStateTag}, affectedJobs.length=${affectedJobs.length}`);
        }

        return res.status(200).json({
            message: `Updated ${updatedRows} tag value(s). Added ${inserts.length} new value(s) for missing minutes.`,
            affectedJobs: affectedJobs.length,
            recalculatedAggregates: isStateTag ? affectedJobs.length : 0
        });

    } catch (error) {
        await transaction.rollback();
        console.error("Error updating tag values:", error);
        res.status(500).json({ message: "Server error during tag values update." });
    }
};


 
exports.deleteTagValue = async (req, res) => {
  try {
    const result = await TagValues.destroy({
      where: { id: req.params.id },
    });
    if (result == 0) {
      return res.status(404).send({ message: "TagValue not found" });
    }
    res.send({ message: "TagValue deleted successfully" });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getTagValuesByDateRange = async (req, res) => {
  const { tagId, startDate, endDate } = req.query;

  // Validate the required parameters
  if (!tagId || !startDate || !endDate) {
    return res
      .status(400)
      .json({ message: "tagId, startDate, and endDate are required." });
  }

  try {
    // Fetch tagValues within the specified UTC date range
    const tagValues = await TagValues.findAll({
      where: {
        tagId,
        createdAt: {
          [Op.gte]: new Date(startDate).toISOString(),
          [Op.lte]: new Date(endDate).toISOString(),
        },
      },
      order: [["createdAt", "ASC"]],
    });

    res.status(200).json({ data: tagValues });
  } catch (error) {
    console.error("Error fetching tag values:", error);
    res
      .status(500)
      .json({ message: "An error occurred while fetching tag values." });
  }
};

exports.getAllTagValuesPaginated = async (req, res) => {
  const limit = parseInt(req.query.limit) || 10; // Default limit to 10 items per page
  const page = parseInt(req.query.page) || 0; // Default to first page
  const tagId = req.query.tagId; // Optional filter by tagId

  try {
    const where = tagId ? { tagId } : {};
    const tagValues = await TagValues.findAndCountAll({
      where: where,
      order: [["createdAt", "DESC"]], // Assumes createdAt is available to sort by
      limit: limit,
      offset: page * limit,
    });
    res.send({
      total: tagValues.count,
      pages: Math.ceil(tagValues.count / limit),
      currentPage: page,
      tagValues: tagValues.rows,
    });
  } catch (error) {
    res.status(500).send(error);
  }
};

 exports.uploadTagValues = async (req, res) => {
  try {
    const file = req.file;
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    const header = sheet[0];
    const dataRows = sheet.slice(1);

    // Pre-fetch all data once and create maps for O(1) lookups
    const [allTags, allLines, allPrograms, allJobs] = await Promise.all([
      Tags.findAll(),
      Line.findAll({ attributes: ['id', 'name'] }),
      Program.findAll({ 
        where: { endDate: null },
        attributes: ['id', 'startDate', 'endDate'],
        order: [['startDate', 'DESC']]
      }),
      Job.findAll({
        where: { actualEndTime: null },
        attributes: ['id', 'lineId', 'actualStartTime', 'programId'],
        order: [['actualStartTime', 'DESC']]
      })
    ]);

    const tagMap = new Map(allTags.map(t => [t.id, t]));
    const lineMap = new Map(allLines.map(l => [l.id, l]));
    
    // Group jobs by lineId for faster lookup
    const openJobsByLine = new Map();
    allJobs.forEach(job => {
      if (!openJobsByLine.has(job.lineId)) {
        openJobsByLine.set(job.lineId, []);
      }
      openJobsByLine.get(job.lineId).push(job);
    });

    // Get active program (latest one)
    let activeProgram = allPrograms.length > 0 ? allPrograms[0] : null;

    const parsedTagIds = header.slice(1).map(h => parseInt(h));
    
    // Group tag value entries by timestamp to process them in batches
    const entriesByTime = new Map();

    for (let row of dataRows) {
      const rawDate = row[0];
        const createdAt = excelSerialDateToJSDate(rawDate);
        const localCreatedAt = new Date(createdAt.getTime() - createdAt.getTimezoneOffset() * 60000);

        if (isNaN(localCreatedAt)) {
        console.warn(`⚠️ Skipping row with invalid date: ${JSON.stringify(row[0])}`);
        continue;
      }

        const currentTime = moment(localCreatedAt).format("YYYY-MM-DD HH:mm:ss");
      const utcNow = moment.utc(currentTime).format("YYMMDDHHmm");

      if (!entriesByTime.has(currentTime)) {
        entriesByTime.set(currentTime, { entries: [], utcNow });
      }

      parsedTagIds.forEach((tagId, idx) => {
        const value = row[idx + 1];
        if (tagId && value != null) {
          entriesByTime.get(currentTime).entries.push({ tagId, value });
        }
      });
    }

    // Process entries in chronological order (important for job/program logic)
    const sortedTimes = Array.from(entriesByTime.keys()).sort();
    
    // Batch insert tag values to reduce database calls
    const allTagValueInserts = [];
    const jobsToRecalculate = new Set();
    
    for (const currentTime of sortedTimes) {
      const { entries, utcNow } = entriesByTime.get(currentTime);
      
      // Prepare batch insert for tag values
      const tagValueBatch = entries.map(({ tagId, value }) => ({
        tagId,
        value,
        createdAt: currentTime,
        updatedAt: currentTime
      }));
      
      allTagValueInserts.push(...tagValueBatch);

      // Process special tags (bac, prgm) logic
      const transaction = await sequelize.transaction();
      try {
        // Insert tag values in batch
        await TagValues.bulkCreate(tagValueBatch, { transaction });

        // Process program and job logic for special tags
        for (const { tagId, value } of entries) {
          const tag = tagMap.get(tagId);
          if (!tag) continue;

          if ((tag.ref === TagRefs.BATCH_ACTIVE || tag.ref === TagRefs.CURRENT_PROGRAM) && tag.taggableType !== "line") {
            throw new Error(`Tag ${tagId} ref '${tag.ref}' must be linked to line`);
          }

          if (tag.ref === TagRefs.CURRENT_PROGRAM) {
            const lineId = tag.taggableId;

            if (value === 1 && !activeProgram) {
              const line = lineMap.get(lineId);
              const programName = `${line?.name || `Line_${lineId}`}_${utcNow}`;

              const newProgram = await Program.create({
                number: programName,
                programName,
                description: `Started by tag ${tag.id}`,
                startDate: currentTime,
                endDate: null,
                lineId,
              }, { transaction });

              // Update activeProgram reference for subsequent entries
              activeProgram = newProgram;

            } else if (value === 0 && activeProgram) {
              await activeProgram.update({ endDate: currentTime }, { transaction });
              activeProgram = null; // Clear active program
            }
          }

          else if (tag.ref === TagRefs.BATCH_ACTIVE) {
            const lineId = tag.taggableId;
            const lineJobs = openJobsByLine.get(lineId) || [];

            if (value === 1) {
              const existingOpenJob = lineJobs.length > 0 ? lineJobs[0] : null;

              if (!existingOpenJob) {
                if (!activeProgram) throw new Error("No active program found");

                const line = lineMap.get(lineId);
                const jobName = `${line?.name || `Line_${lineId}`}.Run_${utcNow}`;

                const newJob = await Job.create({
                  jobName,
                  actualStartTime: currentTime,
                  actualEndTime: null,
                  lineId,
                  programId: activeProgram.id,
                }, { transaction });

                // Add to our tracking
                if (!openJobsByLine.has(lineId)) {
                  openJobsByLine.set(lineId, []);
                }
                openJobsByLine.get(lineId).unshift(newJob);
              }
            } else if (value === 0) {
              const openJob = lineJobs.length > 0 ? lineJobs[0] : null;

              if (openJob) {
                await openJob.update(
                  { actualEndTime: currentTime },
                  { transaction }
                );

                // Remove from tracking
                const jobIndex = lineJobs.findIndex((j) => j.id === openJob.id);
                if (jobIndex > -1) {
                  lineJobs.splice(jobIndex, 1);
                }

                // Add to recalculation queue
                jobsToRecalculate.add(openJob.id);

                // Handle recipe logic
                const recipeTag = allTags.find(
                  (t) =>
                    t.ref === TagRefs.RECIPE &&
                    t.taggableType === "line" &&
                    t.taggableId === openJob.lineId
                );

                if (recipeTag) {
                  const recipeTag = await Tags.findOne({
                    where: { taggableId: lineId, ref: TagRefs.RECIPE },
                  });
                  if (!recipeTag) throw new Error("Recipe tag not found");

                  const minuteStart = dayjs(openJob.actualStartTime)
                    .startOf("minute")
                    .toDate();
                  const minuteEnd = dayjs(openJob.actualStartTime)
                    .endOf("minute")
                    .toDate();

                  const recipeValue = await TagValues.findOne({
                    where: {
                      tagId: recipeTag.id,
                      createdAt: {
                        [Op.between]: [minuteStart, minuteEnd],
                      },
                    },
                    order: [["createdAt", "DESC"]], // Get latest value within the same minute
                    attributes: ["value"],
                    raw: true,
                  });

                  const recipeNumber = parseInt(recipeValue?.value || 0);

                  const recipe = await Recipie.findOne({
                    where: { number: recipeNumber },
                    attributes: ["id", "skuId"],
                    limit: 1,
                    transaction,
                    raw: true,
                  });

                  if (recipe.length > 0 && recipe[0].skuId) {
                    await openJob.update(
                      { skuId: recipe[0].skuId },
                      { transaction }
                    );
                  }
                }
              }
            }
          }
        }

        await transaction.commit();

        // Batch recalculate aggregates for all closed jobs - OUTSIDE transaction
        if (jobsToRecalculate.size > 0) {
          console.log(`🔄 Recalculating aggregates for ${jobsToRecalculate.size} jobs...`);
          const recalculationPromises = Array.from(jobsToRecalculate).map(jobId => 
                            handleRecalculation(jobId).catch(err => 
              console.error(`❌ Failed to queue recalculation for job ${jobId}:`, err.message)
            )
          );
          await Promise.allSettled(recalculationPromises);
          console.log(`✅ Queued recalculation for ${jobsToRecalculate.size} jobs`);
        }

        // Batch notify subscribers (reduce websocket overhead)
        const notifications = entries.map(({ tagId, value }) => ({ tagId, value, currentTime }));
        for (const { tagId, value } of notifications) {
          tagSubscriptionService.notifySubscribers(tagId, value, currentTime);
        }

      } catch (err) {
        await transaction.rollback();
        console.error(`❌ Error processing batch at ${currentTime}:`, err.message);
        throw err; // Re-throw to stop processing
      }
    }

    // Clean up file
    fs.unlink(file.path, err => {
      if (err) console.warn("⚠️ File deletion failed:", err.message);
    });

    res.status(201).json({ 
      message: "Tag values imported and processed successfully.",
      summary: {
        totalTagValues: allTagValueInserts.length,
        jobsRecalculated: jobsToRecalculate.size
      }
    });
    
  } catch (error) {
    console.error("❌ Excel Upload Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Method 3: Quick verification query to check specific data
exports.quickVerifyTagValues = async (req, res) => {
  try {
    const { tagIds, startDate, endDate } = req.query;
    
    const whereClause = {};
    
    if (tagIds) {
      whereClause.tagId = { [Op.in]: tagIds.split(',').map(id => parseInt(id)) };
    }
    
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.gte]: startDate,
        [Op.lte]: endDate
      };
    }
    
    // Get summary statistics
    const [countResult, minMaxResult, sampleData] = await Promise.all([
      // Count by tagId
      TagValues.findAll({
        where: whereClause,
        attributes: [
          'tagId',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('MIN', sequelize.col('value')), 'minValue'],
          [sequelize.fn('MAX', sequelize.col('value')), 'maxValue'],
          [sequelize.fn('AVG', sequelize.col('value')), 'avgValue']
        ],
        group: ['tagId'],
        raw: true
      }),
      
      // Overall min/max timestamps
      TagValues.findAll({
        where: whereClause,
        attributes: [
          [sequelize.fn('MIN', sequelize.col('createdAt')), 'earliestTime'],
          [sequelize.fn('MAX', sequelize.col('createdAt')), 'latestTime'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'totalRecords']
        ],
        raw: true
      }),
      
      // Sample data for spot checking
      TagValues.findAll({
        where: whereClause,
        order: [['createdAt', 'ASC']],
        limit: 20,
        raw: true
      })
    ]);
    
    res.json({
      summary: minMaxResult[0],
      tagBreakdown: countResult,
      sampleData: sampleData,
      instructions: {
        howToVerify: [
          "1. Check if totalRecords matches your XLSX row count",
          "2. Verify earliestTime and latestTime match your XLSX date range",
          "3. Spot check sampleData values against your XLSX",
          "4. Use tagBreakdown to verify each tag has expected number of entries"
        ]
      }
    });
    
  } catch (error) {
    console.error("❌ Quick Verify Error:", error);
    res.status(500).json({ error: error.message });
  }
};

 // ---------- Add this helper once near the top of the file ----------
const toTwo = (n) => n.toString().padStart(2, '0');

// Alternative using toISOString() method (simpler approach)
function formatCreatedAtSimple(dateString) {
  const date = new Date(dateString);
  // Convert to local time instead of UTC to avoid timezone issues
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Accepts Excel serial (number), JS Date, or string like:
 *  - "8/19/2025 3:50:00 PM"
 *  - "2025-08-19 15:50:00"
 *  - ISO strings
 * Returns { formatted: "YYYY-MM-DD HH:mm:00", minuteStart: string, minuteEnd: string } in local time
 */
function parseExcelCreatedAt(raw) {
  let d;

  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    // Excel serial → JS Date (local)
    d = excelSerialDateToJSDate(raw);
  } else if (raw instanceof Date) {
    d = raw;
  } else if (typeof raw === 'string') {
    // Use the simpler toISOString approach
    d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid date string: ${raw}`);
    }
  } else {
    throw new Error(`Invalid createdAt value: ${raw}`);
  }

  // Use the simpler toISOString approach
  const formatted = formatCreatedAtSimple(d);
  
  // Create minute boundaries for checking existing data (as strings)
  const minuteStart = formatCreatedAtSimple(new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0));
  const minuteEnd = formatCreatedAtSimple(new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 59, 999));

  return { formatted, minuteStart, minuteEnd };
}
// -------------------------------------------------------------------



// ============================ PREVIEW ===============================
exports.previewMissingTagValues = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Check file size and warn if large
    const fileSizeInMB = file.size / (1024 * 1024);
    console.log(`📁 Processing file: ${file.originalname} (${fileSizeInMB.toFixed(2)}MB)`);
    
    if (fileSizeInMB > 50) {
      console.warn(`⚠️  Large file detected: ${fileSizeInMB.toFixed(2)}MB - Processing may take longer`);
    }

    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    const header = sheet[0] || [];
    const dataRows = sheet.slice(1);

    // Detect new format: createdAt | tags
    const isNewFormat = header[1] === 'tags' || header[1] === 'Tags';

    // Determine tagIds from header (old) or first row's tags blob (new)
    let tagIds = [];
    if (isNewFormat) {
      if (dataRows.length > 0 && dataRows[0][1]) {
        const tagsString = dataRows[0][1] + '';
        const tagsMatch = tagsString.match(/'(\d+)':\s*([^,}]+)/g);
        if (tagsMatch) {
          tagIds = tagsMatch
            .map(m => {
              const idMatch = m.match(/'(\d+)'/);
              return idMatch ? parseInt(idMatch[1], 10) : null;
            })
            .filter(id => id !== null);
        }
      }
    } else {
      tagIds = header.slice(1).map(h => parseInt(h, 10)).filter(id => !isNaN(id));
    }

    if (tagIds.length === 0) {
      return res.status(400).json({
        error:
          "No valid tag IDs found. Expected either:\n- createdAt | tags (e.g., {'69': 0, '70': 4096.0, ...})\n- createdAt | 69 | 70 | 71 | ..."
      });
    }

    const results = {
      totalRows: dataRows.length,
      totalTagIds: tagIds.length,
      processedRows: 0,
      willInsertRows: 0,
      willSkipRows: 0,
      willInsertTagValues: 0,
      errors: [],
      details: { willInsert: [], willSkip: [] }
    };

    // Process in batches for large files to prevent timeouts
    const BATCH_SIZE = 1000;
    const totalRows = dataRows.length;
    console.log(`📊 Processing ${totalRows} rows in batches of ${BATCH_SIZE}`);

    for (let batchStart = 0; batchStart < totalRows; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalRows);
      const currentBatch = dataRows.slice(batchStart, batchEnd);
      
      console.log(`🔄 Processing batch ${Math.floor(batchStart/BATCH_SIZE) + 1}/${Math.ceil(totalRows/BATCH_SIZE)} (rows ${batchStart + 1}-${batchEnd})`);

      for (let i = 0; i < currentBatch.length; i++) {
        const rowIndex = batchStart + i;
        const row = currentBatch[i];
        const excelRowNumber = rowIndex + 2; // header is row 1

        try {
        const rawDate = row[0];
        if (rawDate == null || rawDate === '') {
          results.errors.push({ row: excelRowNumber, error: "Missing createdAt date" });
          continue;
        }

        // Parse and minute-normalize
        let parsed;
        try {
          parsed = parseExcelCreatedAt(rawDate);
        } catch (e) {
          results.errors.push({ row: excelRowNumber, error: e.message });
          continue;
        }
        const { formatted: formattedCreatedAt, minuteStart, minuteEnd } = parsed;
        
        // Debug logging for first 3 rows
        if (rowIndex < 3) {
          console.log(`🔍 Row ${excelRowNumber}: Raw date: ${rawDate} (type: ${typeof rawDate})`);
          console.log(`🔍 Converted to: ${formattedCreatedAt}`);
          console.log(`🔍 Will query database with: createdAt BETWEEN "${minuteStart}" AND "${minuteEnd}"`);
        }

        // Check existing by minute window using raw SQL to avoid timezone conversion
        // Use parameterized query for better performance and security
        const existingTagValues = await sequelize.query(
          `SELECT id, tagId, value, createdAt, updatedAt 
           FROM TagValues 
           WHERE tagId IN (:tagIds) 
           AND createdAt >= :minuteStart 
           AND createdAt <= :minuteEnd`,
          { 
            type: sequelize.QueryTypes.SELECT,
            replacements: {
              tagIds: tagIds,
              minuteStart: minuteStart,
              minuteEnd: minuteEnd
            }
          }
        );

        const existingTagIds = existingTagValues.map(tv => tv.tagId);
        const missingTagIds = tagIds.filter(id => !existingTagIds.includes(id));

        if (existingTagValues.length === tagIds.length) {
          // fully present → skip
          results.willSkipRows++;
          results.details.willSkip.push({
            row: excelRowNumber,
            createdAt: formattedCreatedAt,
            reason: "All tags already exist for this minute",
            existingTags: existingTagIds
          });
          continue;
        }

        if (existingTagValues.length > 0) {
          // partially present → skip (we don't do partial inserts)
          results.willSkipRows++;
          results.details.willSkip.push({
            row: excelRowNumber,
            createdAt: formattedCreatedAt,
            reason: "Partial data exists for this minute",
            existingTags: existingTagIds,
            missingTags: missingTagIds,
            note: `Existing ${existingTagIds.length} / Missing ${missingTagIds.length} — skipping to avoid partial minute`
          });
          continue;
        }

        // none present → prepare full insert preview
        const validTagValues = [];
        if (isNewFormat) {
          const tagsString = (row[1] ?? '') + '';
          const tagsMatch = tagsString.match(/'(\d+)':\s*([^,}]+)/g);
          if (tagsMatch) {
            tagsMatch.forEach(match => {
              const idMatch = match.match(/'(\d+)'/);
              const valueMatch = match.match(/:\s*([^,}]+)/);
              if (idMatch && valueMatch) {
                const tagId = parseInt(idMatch[1], 10);
                const val = parseFloat(valueMatch[1]);
                if (tagId && !Number.isNaN(val)) validTagValues.push({ tagId, value: val });
              }
            });
          }
        } else {
          for (let i = 0; i < tagIds.length; i++) {
            const tagId = tagIds[i];
            const cellVal = row[i + 1];
            if (cellVal !== undefined && cellVal !== '' && cellVal !== null) {
              const val = parseFloat(cellVal);
              if (!Number.isNaN(val)) validTagValues.push({ tagId, value: val });
            }
          }
        }

        if (validTagValues.length > 0) {
          results.willInsertRows++;
          results.willInsertTagValues += validTagValues.length;
          results.details.willInsert.push({
            row: excelRowNumber,
            createdAt: formattedCreatedAt,
            tagValues: validTagValues,
            totalTagsForTimestamp: tagIds.length,
            existingTagsCount: existingTagValues.length,
            note: "All tags missing for this minute — full row will be inserted"
          });
        }

        results.processedRows++;
        } catch (rowErr) {
          results.errors.push({ row: excelRowNumber, error: rowErr.message });
        }
      }
      
      // Add small delay between batches to prevent overwhelming the system
      if (batchEnd < totalRows) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    console.log(`✅ Completed processing ${totalRows} rows`);

    // Temp file bookkeeping for confirm step
    const tempFileId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    global.tempFiles = global.tempFiles || {};
    global.tempFiles[tempFileId] = file.path;

    // Cleanup after 1h
    setTimeout(() => {
      if (global.tempFiles && global.tempFiles[tempFileId]) {
        fs.unlink(global.tempFiles[tempFileId], () => {});
        delete global.tempFiles[tempFileId];
      }
    }, 3600000);

    // Compose response - only send willInsert data and errors
    const response = {
      message: "Preview completed - Review the data below",
      status: "preview",
      tempFileId,
      summary: {
        totalRows: results.totalRows,
        processedRows: results.processedRows,
        willInsertRows: results.willInsertRows,
        willSkipRows: results.willSkipRows,
        willInsertTagValues: results.willInsertTagValues,
        errorCount: results.errors.length
      },
      dataToInsert: results.details.willInsert, // Send all data to be inserted
      errors: results.errors, // Send all errors
      confirmationRequired: results.willInsertRows > 0
    };

    if (results.errors.length === 0 && results.willInsertRows === 0) {
      response.status = "no_action_needed";
      response.message = "No new data to insert - all minutes already exist";
    } else if (results.errors.length > 0 && results.willInsertRows === 0) {
      response.status = "errors_only";
      response.message = "Errors found - no valid rows to insert";
    } else if (results.willInsertRows > 0) {
      response.status = "ready_to_insert";
      response.message = `Ready to insert ${results.willInsertRows} minute-rows (${results.willInsertTagValues} tag values)`;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("❌ Preview Missing Tag Values Error:", error);
    return res.status(500).json({ error: error.message, status: "failed" });
  }
};
// ========================== /PREVIEW ================================



// =========================== CONFIRM ================================
exports.confirmAndInsertMissingTagValues = async (req, res) => {
  try {
    const { tempFileId, dataToInsert } = req.body;
    
    if (!tempFileId) {
      return res.status(400).json({ error: "tempFileId is required" });
    }
    
    if (!dataToInsert || !Array.isArray(dataToInsert) || dataToInsert.length === 0) {
      return res.status(400).json({ error: "dataToInsert array is required and cannot be empty" });
    }

    // Cleanup temp file if it exists
    if (global.tempFiles && global.tempFiles[tempFileId]) {
      const filePath = global.tempFiles[tempFileId];
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {});
      }
      delete global.tempFiles[tempFileId];
    }

    const results = {
      totalRows: dataToInsert.length,
      insertedRows: 0,
      insertedTagValues: 0,
      errors: [],
      details: { inserted: [] }
    };

    // Validate all tag IDs exist before processing any data
    const allTagIds = new Set();
    for (const item of dataToInsert) {
      if (item.tagValues && Array.isArray(item.tagValues)) {
        for (const tv of item.tagValues) {
          if (tv.tagId) {
            allTagIds.add(tv.tagId);
          }
        }
      }
    }

    // Check if all tag IDs exist in the database
    const uniqueTagIds = Array.from(allTagIds);
    console.log(`🔍 Validating ${uniqueTagIds.length} unique tag IDs: ${uniqueTagIds.join(', ')}`);
    
    const existingTags = await sequelize.query(
      `SELECT id FROM tags WHERE id IN (${uniqueTagIds.map(() => '?').join(',')})`,
      { 
        type: sequelize.QueryTypes.SELECT,
        replacements: uniqueTagIds
      }
    );
    
    const existingTagIds = existingTags.map(tag => tag.id);
    const missingTagIds = uniqueTagIds.filter(id => !existingTagIds.includes(id));
    
    if (missingTagIds.length > 0) {
      console.error(`❌ Missing tag IDs in database: ${missingTagIds.join(', ')}`);
      return res.status(400).json({
        error: "Tag validation failed",
        message: `The following tag IDs do not exist in the database: ${missingTagIds.join(', ')}`,
        missingTagIds: missingTagIds,
        existingTagIds: existingTagIds
      });
    }
    
    console.log(`✅ All tag IDs validated successfully`);

    // Process each item from dataToInsert
    for (let i = 0; i < dataToInsert.length; i++) {
      const item = dataToInsert[i];
      
      console.log(`📋 Processing item ${i}:`, {
        row: item.row,
        createdAt: item.createdAt,
        tagValuesCount: item.tagValues?.length || 0,
        sampleTagValue: item.tagValues?.[0] || 'none'
      });
      
      try {
        if (!item.createdAt || !item.tagValues || !Array.isArray(item.tagValues)) {
          results.errors.push({ 
            index: i, 
            row: item.row || 'unknown',
            error: "Invalid data structure - missing createdAt or tagValues" 
          });
          continue;
        }

        // Prepare tag values for bulk insert
        const tagValuesToInsert = item.tagValues.map(tv => ({
          tagId: tv.tagId,
          value: tv.value,
          createdAt: item.createdAt,
          updatedAt: item.createdAt
        }));

        if (tagValuesToInsert.length > 0) {
          // Console log all columns for each row to verify format
          console.log(`🔍 About to RAW INSERT ${tagValuesToInsert.length} tag values for item ${i} (Row ${item.row}):`);
          console.log(`📅 Original createdAt from frontend: "${item.createdAt}"`);
          
          // Build raw SQL insert to avoid any timezone conversions
          const values = tagValuesToInsert.map(tv => 
            `(${tv.tagId}, ${tv.value}, '${item.createdAt}', '${item.createdAt}')`
          ).join(', ');
          
          const rawSql = `INSERT INTO TagValues (tagId, value, createdAt, updatedAt) VALUES ${values}`;
          
          console.log(`🔍 Raw SQL (first 200 chars): ${rawSql.substring(0, 200)}...`);
          
          // Log first few tag values
          tagValuesToInsert.forEach((tv, index) => {
            if (index < 3) { // Only log first 3 to avoid spam
              console.log(`  Row ${index + 1}: tagId=${tv.tagId}, value=${tv.value}, createdAt="${item.createdAt}"`);
            }
          });
          
          // Execute raw SQL insert
          await sequelize.query(rawSql, { type: sequelize.QueryTypes.INSERT });
          results.insertedRows++;
          results.insertedTagValues += tagValuesToInsert.length;

          results.details.inserted.push({
            row: item.row,
            createdAt: item.createdAt,
            tagValues: item.tagValues,
            insertedCount: tagValuesToInsert.length
          });

          // Notify subscribers
          for (const tv of item.tagValues) {
            tagSubscriptionService.notifySubscribers(tv.tagId, tv.value, item.createdAt);
          }
        }

      } catch (rowErr) {
        console.error(`❌ Error processing item ${i} (row ${item.row}):`, rowErr);
        results.errors.push({ 
          index: i, 
          row: item.row || 'unknown',
          error: `${rowErr.name}: ${rowErr.message}` || 'Unknown validation error',
          details: rowErr.stack ? rowErr.stack.split('\n')[0] : 'No stack trace available'
        });
      }
    }

    const response = {
      message: "Gap-filling operation completed",
      summary: {
        totalRows: results.totalRows,
        insertedRows: results.insertedRows,
        insertedTagValues: results.insertedTagValues,
        errorCount: results.errors.length
      },
      details: {
        inserted: results.details.inserted,
        errors: results.errors
      },
      summaryNote: results.details.inserted
        .map(item => `At ${item.createdAt}: Inserted ${item.insertedCount} tag values`)
        .join('; ')
    };

    if (results.errors.length === 0) {
      response.status = "success";
      response.message += " — All rows processed successfully";
    } else if (results.insertedRows > 0) {
      response.status = "partial_success";
      response.message += ` — ${results.insertedRows} rows inserted, ${results.errors.length} errors`;
    } else {
      response.status = "failed";
      response.message = "No rows were inserted due to errors";
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("❌ Confirm and Insert Missing Tag Values Error:", error);
    return res.status(500).json({ error: error.message, status: "failed" });
  }
};
// ========================= /CONFIRM ================================


function excelSerialDateToJSDate(serial) {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);

  const fractional_day = serial - Math.floor(serial) + 0.0000001;
  let total_seconds = Math.floor(86400 * fractional_day);

  const seconds = total_seconds % 60;
  total_seconds -= seconds;

  const hours = Math.floor(total_seconds / 3600);
  const minutes = Math.floor((total_seconds % 3600) / 60);

  return new Date(
    date_info.getFullYear(),
    date_info.getMonth(),
    date_info.getDate(),
    hours,
    minutes,
    seconds
  );
}

// ============================ MERGE TAG EXCEL ===============================
/**
 * Merge multiple Excel files with tag data by timestamp
 * - First file should have all tag IDs in header
 * - Subsequent files can have subset of tags
 * - Missing tags in later files are forward-filled from previous values
 * - Returns a single merged Excel file
 */
exports.mergeTagExcel = async (req, res) => {
  try {
    console.log('📥 Received request to merge files');
    console.log('📦 req.files:', req.files);
    console.log('📦 req.file:', req.file);
    console.log('📦 req.body:', req.body);
    
    const files = req.files;
    if (!files || files.length === 0) {
      console.log('❌ No files received in req.files');
      return res.status(400).json({ error: "No files uploaded. Please upload at least one Excel file." });
    }

    console.log(`📁 Merging ${files.length} Excel file(s)`);

    // Arrays to hold parsed data from each file
    const filesData = [];
    
    // Parse all uploaded files
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      console.log(`📖 Reading file ${fileIndex + 1}: ${file.originalname}`);
      
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

      const header = sheet[0] || [];
      const dataRows = sheet.slice(1);

      // Extract tag IDs from header (skip first column which is timestamp)
      const tagIds = header.slice(1).map(h => {
        const parsed = parseInt(h);
        return isNaN(parsed) ? null : parsed;
      }).filter(id => id !== null);

      if (tagIds.length === 0) {
        // Clean up uploaded files
        files.forEach(f => fs.unlinkSync(f.path));
        return res.status(400).json({ 
          error: `File ${fileIndex + 1} (${file.originalname}) has no valid tag ID columns. Expected format: timestamp | tagId1 | tagId2 | ...` 
        });
      }

      // Parse data rows
      const parsedRows = [];
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rawTimestamp = row[0];
        
        if (!rawTimestamp) continue; // Skip empty rows

        // Parse timestamp
        let timestamp;
        try {
          if (typeof rawTimestamp === 'number') {
            // Excel serial date
            timestamp = excelSerialDateToJSDate(rawTimestamp);
          } else {
            timestamp = new Date(rawTimestamp);
          }
          
          if (isNaN(timestamp.getTime())) {
            console.warn(`⚠️ Invalid timestamp in file ${fileIndex + 1}, row ${i + 2}: ${rawTimestamp}`);
            continue;
          }
        } catch (e) {
          console.warn(`⚠️ Error parsing timestamp in file ${fileIndex + 1}, row ${i + 2}: ${e.message}`);
          continue;
        }

        // Extract tag values (map tagId -> value)
        const tagValues = {};
        for (let j = 0; j < tagIds.length; j++) {
          const tagId = tagIds[j];
          const cellValue = row[j + 1]; // +1 because first column is timestamp
          
          // Only store non-empty values
          if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
            const numValue = parseFloat(cellValue);
            if (!isNaN(numValue)) {
              tagValues[tagId] = numValue;
            }
          }
        }

        // Format timestamp as "YYYY-MM-DD HH:mm:ss" to match original format
        const year = timestamp.getFullYear();
        const month = String(timestamp.getMonth() + 1).padStart(2, '0');
        const day = String(timestamp.getDate()).padStart(2, '0');
        const hours = String(timestamp.getHours()).padStart(2, '0');
        const minutes = String(timestamp.getMinutes()).padStart(2, '0');
        const seconds = String(timestamp.getSeconds()).padStart(2, '0');
        const formattedTimestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

        parsedRows.push({
          timestamp: timestamp,
          timestampStr: formattedTimestamp,
          tagValues: tagValues,
          sourceFile: fileIndex + 1
        });
      }

      filesData.push({
        fileIndex: fileIndex + 1,
        filename: file.originalname,
        tagIds: tagIds,
        rows: parsedRows
      });

      console.log(`✅ File ${fileIndex + 1}: ${parsedRows.length} rows, ${tagIds.length} tag IDs`);
    }

    // Collect all unique tag IDs across all files
    const allTagIds = new Set();
    filesData.forEach(fileData => {
      fileData.tagIds.forEach(tagId => allTagIds.add(tagId));
    });
    const sortedTagIds = Array.from(allTagIds).sort((a, b) => a - b);

    console.log(`📊 Total unique tag IDs: ${sortedTagIds.length}`);

    // Merge all rows from all files
    const allRows = [];
    filesData.forEach(fileData => {
      allRows.push(...fileData.rows);
    });

    // Sort by timestamp
    allRows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    console.log(`📊 Total rows after merge: ${allRows.length}`);
    
    // Log file boundaries to help debug
    let currentFileIndex = 0;
    allRows.forEach((row, idx) => {
      if (row.sourceFile !== currentFileIndex) {
        currentFileIndex = row.sourceFile;
        console.log(`📍 File ${currentFileIndex} starts at row ${idx + 1}`);
      }
    });

    // Validate chronological order across files (warning only)
    if (files.length > 1) {
      const firstFileLastTimestamp = filesData[0].rows[filesData[0].rows.length - 1]?.timestamp;
      const secondFileFirstTimestamp = filesData[1].rows[0]?.timestamp;
      
      if (firstFileLastTimestamp && secondFileFirstTimestamp) {
        if (secondFileFirstTimestamp < firstFileLastTimestamp) {
          console.warn(`⚠️ Warning: File 2 starts (${secondFileFirstTimestamp.toISOString()}) before File 1 ends (${firstFileLastTimestamp.toISOString()}). There may be timestamp overlaps.`);
        }
      }
    }

    // Create output Excel workbook directly without storing all data in memory
    const outputData = [];
    
    // Header row
    const headerRow = ['timestamp', ...sortedTagIds];
    outputData.push(headerRow);

    // Track previous row's values for forward-fill
    const previousRowValues = {}; // tagId -> value from previous timestamp
    
    // Statistics
    let totalCells = 0;
    let filledCells = 0;
    let forwardFilledCells = 0;

    // Process each row and apply forward-fill only from immediate previous row
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const dataRow = [row.timestampStr]; // Use formatted string "YYYY-MM-DD HH:mm:ss"

      // For each tag ID
      for (const tagId of sortedTagIds) {
        totalCells++;
        let value;
        let wasForwardFilled = false;
        
        if (row.tagValues.hasOwnProperty(tagId)) {
          // Tag is present in this row - use its value
          value = row.tagValues[tagId];
          previousRowValues[tagId] = value; // Update previous value
          filledCells++;
        } else if (previousRowValues.hasOwnProperty(tagId)) {
          // Tag is missing but exists in previous row - forward fill
          value = previousRowValues[tagId];
          filledCells++;
          forwardFilledCells++;
          wasForwardFilled = true;
        }
        // else: Tag doesn't exist in current or previous row - leave undefined (empty cell)

        dataRow.push(value);
      }

      outputData.push(dataRow);
    }
    
    console.log(`📈 Statistics:`);
    console.log(`   Total cells: ${totalCells}`);
    console.log(`   Filled cells: ${filledCells} (${(filledCells/totalCells*100).toFixed(1)}%)`);
    console.log(`   Forward-filled: ${forwardFilledCells} (${(forwardFilledCells/totalCells*100).toFixed(1)}%)`);
    console.log(`   Empty cells: ${totalCells - filledCells} (${((totalCells-filledCells)/totalCells*100).toFixed(1)}%)`);

    // Create workbook and worksheet
    const outputWorkbook = XLSX.utils.book_new();
    const outputWorksheet = XLSX.utils.aoa_to_sheet(outputData);
    XLSX.utils.book_append_sheet(outputWorkbook, outputWorksheet, 'Merged Data');

    // Write to temporary file with compression
    const outputPath = `uploads/merged_${Date.now()}.xlsx`;
    XLSX.writeFile(outputWorkbook, outputPath, { compression: true });

    console.log(`✅ Merged Excel created: ${outputPath}`);

    // Clean up input files
    files.forEach(f => {
      try {
        fs.unlinkSync(f.path);
      } catch (e) {
        console.warn(`⚠️ Could not delete temp file: ${f.path}`);
      }
    });

    // Send the merged file
    res.download(outputPath, 'merged_tag_data.xlsx', (err) => {
      if (err) {
        console.error('❌ Error sending file:', err);
      }
      // Clean up output file after sending
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        console.warn(`⚠️ Could not delete output file: ${outputPath}`);
      }
    });

  } catch (error) {
    console.error("❌ Merge Tag Excel Error:", error);
    
    // Clean up files on error
    if (req.files) {
      req.files.forEach(f => {
        try {
          fs.unlinkSync(f.path);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    }
    
    res.status(500).json({ error: error.message });
  }
};
 