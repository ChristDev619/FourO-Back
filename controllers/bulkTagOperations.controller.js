const { TagValues, sequelize, Op, Tags, Job, Program, Line, Recipie } = require("../dbInit");
const moment = require("moment");
const { tagSubscriptionService } = require("../utils/modules");
const { checkAndTriggerNotifications } = require("../handlers/notificationEventHandler");
// Lazy load queue to avoid connection issues during startup
let recalculationQueue = null;
const getRecalculationQueue = () => {
  if (!recalculationQueue) {
    recalculationQueue = require("../utils/queues/recalculationQueue");
  }
  return recalculationQueue;
};
const TagRefs = require("../utils/constants/TagRefs");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const { recalculateAggregatesForJob } = require("../utils/modules");
const { getGlobalJobNotificationService } = require("../utils/services/GlobalJobNotificationService");
const { getJobStatusService } = require("../utils/services/JobStatusService");
const { getFeedInactivityMonitor } = require("../utils/services/FeedInactivityMonitor");
dayjs.extend(utc);

// Detect environment
const isProduction = process.env.NODE_ENV === 'production';
const isAzureRedis = process.env.REDIS_HOST && (process.env.REDIS_HOST.includes('azure') || process.env.REDIS_HOST.includes('redis.cache.windows.net'));

// Helper function to handle recalculation based on environment
async function handleRecalculation(jobId, transaction = null) {
    if (isProduction && isAzureRedis) {
        // Azure Production: Use async processing with status updates
        console.log(`🔄 Azure Production: Processing recalculation asynchronously for job ${jobId}`);
        const jobStatusService = getJobStatusService();
        
        // Start async processing and return immediately
        const result = await jobStatusService.processJobAsync(jobId, async (jobId) => {
            await recalculateAggregatesForJob(jobId);
        });
        
        if (!result.success) {
            throw new Error(result.message);
        }
        
        return result;
    } else {
        // Local Development: Use Bull queue
        console.log(`🔄 Local Development: Adding job ${jobId} to recalculation queue`);
        await getRecalculationQueue().add({ jobId });
    }
}

/**
 * Bulk Tag Operations API
 * Creates multiple tag values in a single transaction, exactly matching BA data format
 * 
 * @param {Object} req.body - Request body containing:
 *   - sku: SKU identifier
 *   - createdAt: Timestamp for the operation (optional, defaults to current time)
 *   - tags: Object containing ALL tag operations { tagId: value, tagId: value, ... }
 *          Including special tags like prog (131) and batchactive (140)
 * 
 * Example request body (matching your production data):
 * {
 *   "sku": "SKU_KL1_Production",
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "69": 0,
 *     "70": 16,
 *     ...
 *     "131": 1,    // prog (KL1_Filler_CurProg)
 *     ...
 *     "140": 1     // batchactive (KL1_BatchActive)
 *   }
 * }
 */
exports.createBulkTagOperations = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { createdAt, tags } = req.body;

        // Validation
        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: "Tags object is required and must contain at least one tag operation" 
            });
        }

        // Extract prog and batchactive from tags for KL1
        // Tag 131 = prog (KL1_Filler_CurProg), Tag 140 = batchactive (KL1_BatchActive)
        const prog = tags['131'] || 1;  // KL1_Filler_CurProg
        const batchactive = tags['140'] || 0;  // KL1_BatchActive

        // Use provided timestamp or current time
        const operationTime = createdAt ? 
            moment(createdAt).format("YYYY-MM-DD HH:mm:ss") : 
            moment().format("YYYY-MM-DD HH:mm:ss");
        
        const utcNow = moment.utc(operationTime).format("YYMMDDHHmm");

        // Prepare arrays for batch operations
        const tagValueInserts = [];
        const specialTagOperations = [];
        const tagNotifications = [];

        // Pre-fetch all tags we're working with
        const tagIds = Object.keys(tags).map(id => parseInt(id));
        const tagMap = new Map();
        
        const allTags = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            transaction
        });

        allTags.forEach(tag => tagMap.set(tag.id, tag));

        // Process each tag operation
        for (const [tagIdStr, value] of Object.entries(tags)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);

            if (!tag) {
                await transaction.rollback();
                return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
            }

            // Validate that this is NOT a meter tag (accepts line and machine tags)
            if (tag.taggableType === "meter") {
                await transaction.rollback();
                return res.status(400).json({ 
                    error: `Tag ${tagId} (${tag.name}) is a meter tag. Meter tags are not allowed in production endpoints. Use /api/bulk-tag-operations/ems for meter tags.` 
                });
            }

            // Prepare tag value for batch insert
            tagValueInserts.push({
                tagId,
                value,
                createdAt: operationTime,
                updatedAt: operationTime
            });

            // Prepare notification
            tagNotifications.push({ tagId, value, timestamp: operationTime });

            // Check if this is a special tag that requires additional processing
            if (tag.ref === TagRefs.BATCH_ACTIVE || tag.ref === TagRefs.CURRENT_PROGRAM) {
                // Validate type for special tags
                if (tag.taggableType !== "line") {
                    throw new Error(`Tag with ref '${tag.ref}' must be linked to a line. Found type: '${tag.taggableType}'`);
                }
                
                specialTagOperations.push({ tag, value, tagId });
            }
        }

        // Fetch previous tag values for notification comparison
        // USE TAGS.currentValue instead of querying TagValues (60,000x faster!)
        const previousValues = {};
        const tagsWithCurrentValues = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            attributes: ['id', 'currentValue'],
            transaction
        });
        
        tagsWithCurrentValues.forEach(tag => {
            previousValues[tag.id] = tag.currentValue;
        });
        console.log(`🔍 Fetched ${tagsWithCurrentValues.length} previous tag values from Tags.currentValue`);

        // Bulk insert all tag values with upsert capability
        await TagValues.bulkCreate(tagValueInserts, {
            transaction,
            updateOnDuplicate: ['value', 'updatedAt']
        });

        // Prepare tag operations for notification checking
        const tagOperationsForNotifications = tagValueInserts.map(tv => {
            const oldValue = previousValues[tv.tagId] || null;
            console.log(`🔍 DEBUG: TagId ${tv.tagId} - newValue: ${tv.value} (type: ${typeof tv.value}), oldValue: ${oldValue} (type: ${typeof oldValue})`);
            return {
                tagId: tv.tagId,
                value: tv.value,
                oldValue: oldValue
            };
        });

        // Process special tag operations (programs and jobs)
        const jobsToRecalculate = new Set();
        
        // Sort special operations: programs first, then batch operations
        const programOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.CURRENT_PROGRAM);
        const batchOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.BATCH_ACTIVE);
        
        // Process programs first
        for (const { tag, value } of programOperations) {
            await processSpecialTagOperation(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }
        
        // Then process batch operations
        for (const { tag, value } of batchOperations) {
            await processSpecialTagOperation(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }

        // 🔕 WebSocket notifications temporarily commented out for backend testing
        /*
        // Only notify subscribers for production start/stop events (not every minute)
        // This prevents spam notifications during continuous production
        const hasProductionStart = specialTagOperations.some(op => 
            (op.tag.ref === TagRefs.BATCH_ACTIVE || op.tag.ref === TagRefs.CURRENT_PROGRAM) && op.value === 1
        );
        const hasProductionStop = specialTagOperations.some(op => 
            (op.tag.ref === TagRefs.BATCH_ACTIVE || op.tag.ref === TagRefs.CURRENT_PROGRAM) && op.value === 0
        );

        if (hasProductionStart) {
            // Notify: Production/Batch STARTED
            const message = {
                type: 'production_start',
                timestamp: operationTime,
                message: `Batch started at ${operationTime}`,
                prog: prog,
                batchactive: batchactive,

            };
            tagSubscriptionService.notifySubscribers('production_events', message, operationTime);
            console.log(`📢 Notification sent: Batch started at ${operationTime}`);
            
        } else if (hasProductionStop) {
            // Notify: Production/Batch STOPPED
            const message = {
                type: 'production_stop', 
                timestamp: operationTime,
                message: `Batch stopped at ${operationTime}`,
                prog: prog,
                batchactive: batchactive,

            };
            tagSubscriptionService.notifySubscribers('production_events', message, operationTime);
            console.log(`📢 Notification sent: Batch stopped at ${operationTime}`);
        } else {
            // During production run - no notifications (prevents spam)
            console.log(`🔇 No notifications sent - production running normally`);
        }
        */
       // console.log(`🔕 WebSocket notifications disabled for backend testing`)

        // Update Tags.currentValue with new values (SINGLE bulk UPDATE - 50% cheaper!)
        if (tagValueInserts.length > 0) {
            const tagIds = tagValueInserts.map(tv => tv.tagId);
            const caseClauses = tagValueInserts.map(tv => 
                `WHEN ${tv.tagId} THEN '${tv.value.toString().replace(/'/g, "''")}'`
            ).join(' ');
            
            await sequelize.query(`
                UPDATE Tags
                SET 
                    currentValue = CASE id ${caseClauses} END,
                    lastValueUpdatedAt = :operationTime
                WHERE id IN (:tagIds)
            `, {
                replacements: { 
                    tagIds,
                    operationTime 
                },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            });
            console.log(`✅ Updated ${tagValueInserts.length} Tags.currentValue entries (bulk UPDATE)`);
        }

        // Commit transaction BEFORE sending response
        await transaction.commit();

        // Check and trigger notifications (async, non-blocking) - AFTER transaction commit
        setImmediate(() => {
            checkAndTriggerNotifications(tagOperationsForNotifications, operationTime)
                .catch(err => console.error('❌ Notification check failed:', err.message));
        });

        // Mark activity for L1 when at least one item was processed
        if (tagValueInserts.length > 0) {
            setImmediate(() => {
                try {
                    const monitor = getFeedInactivityMonitor();
                    monitor.markLastSeen('l1');
                } catch (e) {
                    console.error('FeedInactivityMonitor L1 markLastSeen failed:', e.message);
                }
            });
        }

        // Queue recalculation for affected jobs ONLY when production stops (prog = 0) - OUTSIDE transaction
        if (jobsToRecalculate.size > 0 && prog === 0) {
            console.log(`🔄 Production stopped (prog=0) - Queuing recalculation for ${jobsToRecalculate.size} jobs...`);
            
            const recalculationPromises = Array.from(jobsToRecalculate).map(jobId => 
                handleRecalculation(jobId).catch(err => 
                    console.error(`❌ Failed to queue recalculation for job ${jobId}:`, err.message)
                )
            );
            
            await Promise.allSettled(recalculationPromises);
        } else if (jobsToRecalculate.size > 0) {
            console.log(`⏸️  Production active (prog=${prog}) - Deferring recalculation for ${jobsToRecalculate.size} jobs until production stops`);
        }

        res.status(201).json({
            message: "Bulk tag operations completed successfully",
            summary: {
                operationTime,
                tagsProcessed: Object.keys(tags).length,
                specialTagsProcessed: specialTagOperations.length,
                jobsForRecalculation: prog === 0 ? jobsToRecalculate.size : 0,
                jobsDeferred: prog !== 0 ? jobsToRecalculate.size : 0,
                metadata: {
                    prog,
                    batchactive,
                    productionStatus: prog === 1 ? "active" : "stopped"
                }
            },
        tagOperations: Object.entries(tags).map(([tagId, value]) => ({
            tagId: parseInt(tagId),
            value,
            createdAt: operationTime
        }))
        });

    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error("Error in bulk tag operations:", error);
        res.status(500).json({ 
            error: error.message,
            details: "Bulk tag operation failed and was rolled back"
        });
    }
};

/**
 * Process special tag operations (BATCH_ACTIVE and CURRENT_PROGRAM)
 * This function handles the complex logic for program and job management
 * 
 * FIXED LOGIC:
 * - Programs: Create only when prog=1 and no active program exists for the line
 * - Programs: Close only when prog=0 and active program exists for the line  
 * - Jobs: Create only when bac=1 and no active job exists for the line
 * - Jobs: Close when bac=0 OR when parent program closes
 */
async function processSpecialTagOperation(tag, value, operationTime, utcNow, transaction, jobsToRecalculate, prog) {
    const lineId = tag.taggableId;
    console.log(`🔧 Processing ${tag.ref} = ${value} for line ${lineId} (prog=${prog})`);

    if (tag.ref === TagRefs.BATCH_ACTIVE) {
        if (value === 1) {
            // Starting a batch - check if job already exists for this line
            const existingOpenJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction,
            });

            if (!existingOpenJob) {
                // Need to create a new job - find active program for this line
                const activeProgram = await Program.findOne({
                    where: { endDate: null, lineId }, // 🔧 FIX: Add lineId filter
                    order: [['startDate', 'DESC']],
                    transaction,
                });

                if (!activeProgram) {
                    throw new Error(`Cannot start a job: No active program found for line ${lineId}.`);
                }

                const line = await Line.findByPk(lineId, { attributes: ['name'], transaction });
                const lineName = line?.name || `Line_${lineId}`;
                const jobName = `${lineName}.Run_${utcNow}`;

                const newJob = await Job.create({
                    jobName,
                    actualStartTime: operationTime,
                    actualEndTime: null,
                    lineId,
                    programId: activeProgram.id,
                }, { transaction });

                console.log(`✅ Created new job ${newJob.id} for line ${lineId} under program ${activeProgram.id}`);
            } else {
                console.log(`🔄 Job ${existingOpenJob.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a batch - close the job for this line
            const openJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction
            });

            if (openJob) {
                await openJob.update({ actualEndTime: operationTime }, { transaction });

                // Handle recipe and SKU assignment
                await handleRecipeAssignment(openJob, operationTime, transaction);
                
                // 🔧 FIX: Always mark for recalculation when job closes, regardless of prog status
                // This ensures job aggregates are calculated when batch ends
                jobsToRecalculate.add(openJob.id);
                
                console.log(`✅ Closed job ${openJob.id} for line ${lineId} (batch ended)`);
            } else {
                console.log(`⚠️  No active job found to close for line ${lineId}`);
            }
        }

    } else if (tag.ref === TagRefs.CURRENT_PROGRAM) {
        if (value === 1) {
            // Starting a program - check if program already exists for this line
            const existingProgram = await Program.findOne({
                where: { endDate: null, lineId }, // 🔧 FIX: Add lineId filter
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (!existingProgram) {
                const line = await Line.findByPk(lineId, {
                    attributes: ['name'],
                    transaction
                });

                const lineName = line?.name || `Line_${lineId}`;
                const programName = `${lineName}_${utcNow}`;

                const newProgram = await Program.create({
                    number: programName,
                    programName,
                    description: `Started by bulk operation for tag ${tag.id}`,
                    startDate: operationTime,
                    endDate: null,
                    lineId,
                }, { transaction });

                console.log(`✅ Created new program ${newProgram.id} for line ${lineId}`);
            } else {
                console.log(`🔄 Program ${existingProgram.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a program - close program for this line
            const openProgram = await Program.findOne({
                where: { endDate: null, lineId }, // 🔧 FIX: Add lineId filter
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (openProgram) {
                await openProgram.update({ endDate: operationTime }, { transaction });
                console.log(`✅ Closed program ${openProgram.id} for line ${lineId}`);
                
                // 🔧 FIX: When program closes, also close any open batch jobs connected to this program
                // This handles cases where program stops but batch is still active (bac=1)
                const openJob = await Job.findOne({
                    where: { 
                        actualEndTime: null, 
                        programId: openProgram.id,
                        lineId // 🔧 FIX: Ensure we're closing jobs for this line only
                    },
                    order: [['actualStartTime', 'DESC']],
                    transaction
                });

                if (openJob) {
                    await openJob.update({ actualEndTime: operationTime }, { transaction });
                    
                    // Handle recipe and SKU assignment
                    await handleRecipeAssignment(openJob, operationTime, transaction);
                    
                    // Mark for recalculation since program is stopping
                    jobsToRecalculate.add(openJob.id);
                    
                    console.log(`✅ Closed job ${openJob.id} connected to program ${openProgram.id} when program ended`);
                }
            } else {
                console.log(`⚠️  No active program found to close for line ${lineId}`);
            }
        }
    }
}

/**
 * Handle recipe assignment for completed jobs
 */
async function handleRecipeAssignment(job, operationTime, transaction) {
    try {
        // SKU will be determined from RECIPE tag (same logic as createTagValue)

        // Otherwise, fall back to the recipe-based SKU assignment
        const recipeTag = await Tags.findOne({
            where: {
                ref: TagRefs.RECIPE,
                taggableType: 'line',
                taggableId: job.lineId
            },
            transaction
        });

        if (recipeTag) {
            const latestRecipeTagVal = await TagValues.findOne({
                where: {
                    tagId: recipeTag.id,
                    createdAt: { [Op.lte]: operationTime }
                },
                order: [['createdAt', 'DESC']],
                transaction
            });

            if (latestRecipeTagVal) {
                const recipeNumber = parseInt(latestRecipeTagVal.value);

                const recipe = await sequelize.query(
                    `SELECT r.id, r.skuId 
                     FROM recipes r
                     JOIN linerecipies lr ON r.id = lr.recipieId  
                     WHERE r.number = :recipeNumber 
                     AND lr.lineId = :lineId 
                     LIMIT 1`,
                    {
                        replacements: { recipeNumber, lineId: job.lineId },
                        type: sequelize.QueryTypes.SELECT,
                        transaction
                    }
                );

                if (recipe.length > 0 && recipe[0].skuId) {
                    await job.update({ skuId: recipe[0].skuId }, { transaction });
                    console.log(`✅ Assigned SKU ${recipe[0].skuId} to job ${job.id} from recipe ${recipeNumber}`);
                }
            }
        }
    } catch (error) {
        console.error(`⚠️ Error handling recipe assignment for job ${job.id}:`, error.message);
        // Don't throw here - we don't want to fail the entire operation for recipe assignment issues
    }
}

/**
 * Get bulk operation history/logs
 * This can be useful for operations teams to track what bulk operations were performed
 */
exports.getBulkOperationHistory = async (req, res) => {
    try {
        const { startDate, endDate, limit = 50, offset = 0 } = req.query;
        
        let whereClause = {};
        
        if (startDate && endDate) {
            whereClause.createdAt = {
                [Op.gte]: new Date(startDate),
                [Op.lte]: new Date(endDate)
            };
        }

        // Get tag values grouped by timestamp to identify bulk operations
        const bulkOperations = await TagValues.findAll({
            where: whereClause,
            attributes: [
                'createdAt',
                [sequelize.fn('COUNT', sequelize.col('id')), 'tagCount'],
                [sequelize.fn('GROUP_CONCAT', sequelize.col('tagId')), 'tagIds'],
                [sequelize.fn('GROUP_CONCAT', sequelize.col('value')), 'values']
            ],
            group: ['createdAt'],
            having: sequelize.literal('COUNT(id) > 1'), // Only show operations with multiple tags
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset),
            raw: true
        });

        res.status(200).json({
            message: "Bulk operation history retrieved successfully",
            data: bulkOperations,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: bulkOperations.length
            }
        });

    } catch (error) {
        console.error("Error retrieving bulk operation history:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Bulk Tag Operations API for BL2 Line
 * Creates multiple tag values for BL2 line in a single transaction
 * 
 * @param {Object} req.body - Request body containing:
 *   - createdAt: Timestamp for the operation (optional, defaults to current time)
 *   - tags: Object containing ALL tag operations { tagId: value, tagId: value, ... }
 *          Including special tags like prog (147) and batchactive (143)
 * 
 * Example request body:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "145": 1,    // BL2_Filler_WS_Cur_State
 *     "146": 2,    // BL2_Filler_WS_Cur_Mode
 *     "147": 1,    // BL2_Filler_WS_Cur_Prog (prog)
 *     "143": 1     // BL2_BatchActive (batchactive)
 *   }
 * }
 */
exports.createBulkTagOperationsBL2 = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { createdAt, tags } = req.body;

        // Validation
        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: "Tags object is required and must contain at least one tag operation" 
            });
        }

        // Extract prog and batchactive from tags for BL2
        // Tag 147 = prog (BL2_Filler_WS_Cur_Prog), Tag 143 = batchactive (BL2_BatchActive)
        const prog = tags['147'] || 1;  // BL2_Filler_WS_Cur_Prog
        const batchactive = tags['143'] || 0;  // BL2_BatchActive

        // Use provided timestamp or current time
        const operationTime = createdAt ? 
            moment(createdAt).format("YYYY-MM-DD HH:mm:ss") : 
            moment().format("YYYY-MM-DD HH:mm:ss");
        
        const utcNow = moment.utc(operationTime).format("YYMMDDHHmm");

        // Prepare arrays for batch operations
        const tagValueInserts = [];
        const specialTagOperations = [];
        const tagNotifications = [];

        // Pre-fetch all tags we're working with
        const tagIds = Object.keys(tags).map(id => parseInt(id));
        const tagMap = new Map();
        
        const allTags = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            transaction
        });

        allTags.forEach(tag => tagMap.set(tag.id, tag));

        // Fetch previous tag values for notification comparison (BL2)
        // USE TAGS.currentValue instead of querying TagValues (60,000x faster!)
        const previousValuesBL2 = {};
        const tagsWithCurrentValuesBL2 = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            attributes: ['id', 'currentValue'],
            transaction
        });
        
        tagsWithCurrentValuesBL2.forEach(tag => {
            previousValuesBL2[tag.id] = tag.currentValue;
        });
        console.log(`🔍 (BL2) Fetched ${tagsWithCurrentValuesBL2.length} previous tag values from Tags.currentValue`);

        // Process each tag operation
        for (const [tagIdStr, value] of Object.entries(tags)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);

            if (!tag) {
                await transaction.rollback();
                return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
            }

            // Validate that this is NOT a meter tag (accepts line and machine tags)
            if (tag.taggableType === "meter") {
                await transaction.rollback();
                return res.status(400).json({ 
                    error: `Tag ${tagId} (${tag.name}) is a meter tag. Meter tags are not allowed in production endpoints. Use /api/bulk-tag-operations/ems for meter tags.` 
                });
            }

            // Prepare tag value for batch insert
            tagValueInserts.push({
                tagId,
                value,
                createdAt: operationTime,
                updatedAt: operationTime
            });

            // Prepare notification
            tagNotifications.push({ tagId, value, timestamp: operationTime });

            // Check if this is a special tag that requires additional processing for BL2
            if (tag.ref === TagRefs.BATCH_ACTIVE || tag.ref === TagRefs.CURRENT_PROGRAM) {
                // Validate type for special tags
                if (tag.taggableType !== "line") {
                    throw new Error(`Tag with ref '${tag.ref}' must be linked to a line. Found type: '${tag.taggableType}'`);
                }
                
                specialTagOperations.push({ tag, value, tagId });
            }
        }

        // Bulk insert all tag values with upsert capability
        await TagValues.bulkCreate(tagValueInserts, {
            transaction,
            updateOnDuplicate: ['value', 'updatedAt']
        });

        // Prepare tag operations for notification checking (BL2)
        const tagOperationsForNotificationsBL2 = tagValueInserts.map(tv => {
            const oldValue = previousValuesBL2[tv.tagId] || null;
            console.log(`🔍 DEBUG: TagId ${tv.tagId} - newValue: ${tv.value} (type: ${typeof tv.value}), oldValue: ${oldValue} (type: ${typeof oldValue})`);
            return {
                tagId: tv.tagId,
                value: tv.value,
                oldValue: oldValue
            };
        });

        // Process special tag operations (programs and jobs) for BL2
        const jobsToRecalculate = new Set();
        
        // Sort special operations: programs first, then batch operations
        const programOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.CURRENT_PROGRAM);
        const batchOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.BATCH_ACTIVE);
        
        // Process programs first
        for (const { tag, value } of programOperations) {
            await processSpecialTagOperationBL2(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }
        
        // Then process batch operations
        for (const { tag, value } of batchOperations) {
            await processSpecialTagOperationBL2(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }

      //  console.log(`🔕 WebSocket notifications disabled for backend testing`)

        // Update Tags.currentValue with new values (BL2 - SINGLE bulk UPDATE - 50% cheaper!)
        if (tagValueInserts.length > 0) {
            const tagIds = tagValueInserts.map(tv => tv.tagId);
            const caseClauses = tagValueInserts.map(tv => 
                `WHEN ${tv.tagId} THEN '${tv.value.toString().replace(/'/g, "''")}'`
            ).join(' ');
            
            await sequelize.query(`
                UPDATE Tags
                SET 
                    currentValue = CASE id ${caseClauses} END,
                    lastValueUpdatedAt = :operationTime
                WHERE id IN (:tagIds)
            `, {
                replacements: { 
                    tagIds,
                    operationTime 
                },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            });
            console.log(`✅ (BL2) Updated ${tagValueInserts.length} Tags.currentValue entries (bulk UPDATE)`);
        }

        // Commit transaction BEFORE sending response
        await transaction.commit();

        // Check and trigger notifications (async, non-blocking) - AFTER transaction commit (BL2)
        setImmediate(() => {
            checkAndTriggerNotifications(tagOperationsForNotificationsBL2, operationTime)
                .catch(err => console.error('❌ BL2 Notification check failed:', err.message));
        });

        // Mark activity for BL2 when at least one item was processed
        if (tagValueInserts.length > 0) {
            setImmediate(() => {
                try {
                    const monitor = getFeedInactivityMonitor();
                    monitor.markLastSeen('bl2');
                } catch (e) {
                    console.error('FeedInactivityMonitor BL2 markLastSeen failed:', e.message);
                }
            });
        }

        // Queue recalculation for affected jobs ONLY when production stops (prog = 0) - OUTSIDE transaction
        if (jobsToRecalculate.size > 0 && prog === 0) {
            console.log(`🔄 BL2 Production stopped (prog=0) - Queuing recalculation for ${jobsToRecalculate.size} jobs...`);
            
            const recalculationPromises = Array.from(jobsToRecalculate).map(jobId => 
                handleRecalculation(jobId).catch(err => 
                    console.error(`❌ Failed to queue recalculation for job ${jobId}:`, err.message)
                )
            );
            
            await Promise.allSettled(recalculationPromises);
        } else if (jobsToRecalculate.size > 0) {
            console.log(`⏸️  BL2 Production active (prog=${prog}) - Deferring recalculation for ${jobsToRecalculate.size} jobs until production stops`);
        }

        res.status(201).json({
            message: "BL2 bulk tag operations completed successfully",
            summary: {
                operationTime,
                tagsProcessed: Object.keys(tags).length,
                specialTagsProcessed: specialTagOperations.length,
                jobsForRecalculation: prog === 0 ? jobsToRecalculate.size : 0,
                jobsDeferred: prog !== 0 ? jobsToRecalculate.size : 0,
                metadata: {
                    prog,
                    batchactive,
                    productionStatus: prog === 1 ? "active" : "stopped",
                    line: "BL2"
                }
            },
            tagOperations: Object.entries(tags).map(([tagId, value]) => ({
                tagId: parseInt(tagId),
                value,
                createdAt: operationTime
            }))
        });

    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error("Error in BL2 bulk tag operations:", error);
        res.status(500).json({ 
            error: error.message,
            details: "BL2 bulk tag operation failed and was rolled back"
        });
    }
};

/**
 * Process special tag operations for BL2 line (BATCH_ACTIVE and CURRENT_PROGRAM)
 * 
 * FIXED LOGIC (Same as KL1):
 * - Programs: Create only when prog=1 and no active program exists for the line
 * - Programs: Close only when prog=0 and active program exists for the line  
 * - Jobs: Create only when bac=1 and no active job exists for the line
 * - Jobs: Close when bac=0 OR when parent program closes
 */
async function processSpecialTagOperationBL2(tag, value, operationTime, utcNow, transaction, jobsToRecalculate, prog) {
    const lineId = tag.taggableId; // Should be 23 for BL2
    console.log(`🔧 BL2 Processing ${tag.ref} = ${value} for line ${lineId} (prog=${prog})`);

    if (tag.ref === TagRefs.BATCH_ACTIVE) {
        if (value === 1) {
            // Starting a batch - check if job already exists for this line
            const existingOpenJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction,
            });

            if (!existingOpenJob) {
                // Need to create a new job - find active program for this line
                const activeProgram = await Program.findOne({
                    where: { endDate: null, lineId }, // ✅ Already correct: lineId filter
                    order: [['startDate', 'DESC']],
                    transaction,
                });

                if (!activeProgram) {
                    throw new Error(`Cannot start a job: No active program found for BL2 line ${lineId}.`);
                }

                const line = await Line.findByPk(lineId, { attributes: ['name'], transaction });
                const lineName = line?.name || `Line_${lineId}`;
                const jobName = `${lineName}.Run_${utcNow}`;

                const newJob = await Job.create({
                    jobName,
                    actualStartTime: operationTime,
                    actualEndTime: null,
                    lineId,
                    programId: activeProgram.id,
                }, { transaction });

                console.log(`✅ Created new BL2 job ${newJob.id} for line ${lineId} under program ${activeProgram.id}`);
            } else {
                console.log(`🔄 BL2 Job ${existingOpenJob.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a batch - close the job for this line
            const openJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction
            });

            if (openJob) {
                await openJob.update({ actualEndTime: operationTime }, { transaction });

                // Handle recipe and SKU assignment
                await handleRecipeAssignmentBL2(openJob, operationTime, transaction);
                
                // 🔧 FIX: Always mark for recalculation when job closes, regardless of prog status
                // This ensures job aggregates are calculated when batch ends
                jobsToRecalculate.add(openJob.id);
                
                console.log(`✅ Closed BL2 job ${openJob.id} for line ${lineId} (batch ended)`);
            } else {
                console.log(`⚠️  No active BL2 job found to close for line ${lineId}`);
            }
        }

    } else if (tag.ref === TagRefs.CURRENT_PROGRAM) {
        if (value === 1) {
            // Starting a program - check if program already exists for this line
            const existingProgram = await Program.findOne({
                where: { endDate: null, lineId }, // ✅ Already correct: lineId filter
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (!existingProgram) {
                const line = await Line.findByPk(lineId, {
                    attributes: ['name'],
                    transaction
                });

                const lineName = line?.name || `Line_${lineId}`;
                const programName = `${lineName}_${utcNow}`;

                const newProgram = await Program.create({
                    number: programName,
                    programName,
                    description: `Started by bulk operation for BL2 tag ${tag.id}`,
                    startDate: operationTime,
                    endDate: null,
                    lineId,
                }, { transaction });

                console.log(`✅ Created new BL2 program ${newProgram.id} for line ${lineId}`);
            } else {
                console.log(`🔄 BL2 Program ${existingProgram.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a program - close program for this line
            const openProgram = await Program.findOne({
                where: { endDate: null, lineId }, // ✅ Already correct: lineId filter
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (openProgram) {
                await openProgram.update({ endDate: operationTime }, { transaction });
                console.log(`✅ Closed BL2 program ${openProgram.id} for line ${lineId}`);
                
                // 🔧 FIX: When program closes, also close any open batch jobs connected to this program
                // This handles cases where program stops but batch is still active (bac=1)
                const openJob = await Job.findOne({
                    where: { 
                        actualEndTime: null, 
                        programId: openProgram.id,
                        lineId // 🔧 FIX: Ensure we're closing jobs for this line only
                    },
                    order: [['actualStartTime', 'DESC']],
                    transaction
                });

                if (openJob) {
                    await openJob.update({ actualEndTime: operationTime }, { transaction });
                    
                    // Handle recipe and SKU assignment for BL2
                    await handleRecipeAssignmentBL2(openJob, operationTime, transaction);
                    
                    // Mark for recalculation since program is stopping
                    jobsToRecalculate.add(openJob.id);
                    
                    console.log(`✅ Closed BL2 job ${openJob.id} connected to program ${openProgram.id} when program ended`);
                }
            } else {
                console.log(`⚠️  No active BL2 program found to close for line ${lineId}`);
            }
        }
    }
}

/**
 * Handle recipe assignment for completed BL2 jobs
 */
async function handleRecipeAssignmentBL2(job, operationTime, transaction) {
    try {
        // SKU will be determined from RECIPE tag for BL2
        const recipeTag = await Tags.findOne({
            where: {
                ref: TagRefs.RECIPE,
                taggableType: 'line',
                taggableId: job.lineId
            },
            transaction
        });

        if (recipeTag) {
            const latestRecipeTagVal = await TagValues.findOne({
                where: {
                    tagId: recipeTag.id,
                    createdAt: { [Op.lte]: operationTime }
                },
                order: [['createdAt', 'DESC']],
                transaction
            });

            if (latestRecipeTagVal) {
                const recipeNumber = parseInt(latestRecipeTagVal.value);

                const recipe = await sequelize.query(
                    `SELECT r.id, r.skuId 
                     FROM recipes r
                     JOIN LineRecipies lr ON r.id = lr.recipieId  
                     WHERE r.number = :recipeNumber 
                     AND lr.lineId = :lineId 
                     LIMIT 1`,
                    {
                        replacements: { recipeNumber, lineId: job.lineId },
                        type: sequelize.QueryTypes.SELECT,
                        transaction
                    }
                );

                if (recipe.length > 0 && recipe[0].skuId) {
                    await job.update({ skuId: recipe[0].skuId }, { transaction });
                    console.log(`✅ Assigned SKU ${recipe[0].skuId} to BL2 job ${job.id} from recipe ${recipeNumber}`);
                }
            }
        }
    } catch (error) {
        console.error(`⚠️ Error handling recipe assignment for BL2 job ${job.id}:`, error.message);
        // Don't throw here - we don't want to fail the entire operation for recipe assignment issues
    }
}

/**
 * Bulk Tag Operations API for EMS Energy
 * Creates multiple tag values for EMS energy meters in a single transaction
 * No special processing - just simple tag value inserts
 * 
 * @param {Object} req.body - Request body containing:
 *   - createdAt: Timestamp for the operation (optional, defaults to current time)
 *   - tags: Object containing meter tag operations { tagId: value, tagId: value, ... }
 * 
 * Example request body:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "158": 1250.5,  // G1_KWH
 *     "159": 980.2,   // G2_KWH
 *     "160": 750.8,   // G3_KWH
 *     "161": 1100.3   // G4_KWH
 *   }
 * }
 */
exports.createBulkTagOperationsEMS = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { createdAt, tags } = req.body;

        // Validation
        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: "Tags object is required and must contain at least one tag operation" 
            });
        }

        // Use provided timestamp or current time
        const operationTime = createdAt ? 
            moment(createdAt).format("YYYY-MM-DD HH:mm:ss") : 
            moment().format("YYYY-MM-DD HH:mm:ss");

        // Prepare arrays for batch operations
        const tagValueInserts = [];
        const tagNotifications = [];

        // Pre-fetch all tags we're working with
        const tagIds = Object.keys(tags).map(id => parseInt(id));
        const tagMap = new Map();
        
        const allTags = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            transaction
        });

        allTags.forEach(tag => tagMap.set(tag.id, tag));

        // Fetch previous tag values for notification comparison (EMS)
        // USE TAGS.currentValue instead of querying TagValues (60,000x faster!)
        const previousValuesEMS = {};
        const tagsWithCurrentValuesEMS = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            attributes: ['id', 'currentValue'],
            transaction
        });
        
        tagsWithCurrentValuesEMS.forEach(tag => {
            previousValuesEMS[tag.id] = tag.currentValue;
        });
        console.log(`🔍 (EMS) Fetched ${tagsWithCurrentValuesEMS.length} previous tag values from Tags.currentValue`);

        // Process each tag operation
        for (const [tagIdStr, value] of Object.entries(tags)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);

            if (!tag) {
                await transaction.rollback();
                return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
            }

            // Validate that this is a meter tag (should be linked to a meter)
            if (tag.taggableType !== "meter") {
                await transaction.rollback();
                return res.status(400).json({ 
                    error: `Tag ${tagId} (${tag.name}) is not a meter tag. Expected taggableType: 'meter', found: '${tag.taggableType}'` 
                });
            }

            // Prepare tag value for batch insert
            tagValueInserts.push({
                tagId,
                value,
                createdAt: operationTime,
                updatedAt: operationTime
            });

            // Prepare notification
            tagNotifications.push({ tagId, value, timestamp: operationTime });
        }

        // Bulk insert all tag values with upsert capability
        await TagValues.bulkCreate(tagValueInserts, {
            transaction,
            updateOnDuplicate: ['value', 'updatedAt']
        });

        // Prepare tag operations for notification checking (EMS)
        const tagOperationsForNotificationsEMS = tagValueInserts.map(tv => ({
            tagId: tv.tagId,
            value: tv.value,
            oldValue: previousValuesEMS[tv.tagId] || null
        }));

     //   console.log(`🔕 WebSocket notifications disabled for backend testing`)

        // Update Tags.currentValue with new values (EMS - SINGLE bulk UPDATE - 50% cheaper!)
        if (tagValueInserts.length > 0) {
            const tagIds = tagValueInserts.map(tv => tv.tagId);
            const caseClauses = tagValueInserts.map(tv => 
                `WHEN ${tv.tagId} THEN '${tv.value.toString().replace(/'/g, "''")}'`
            ).join(' ');
            
            await sequelize.query(`
                UPDATE Tags
                SET 
                    currentValue = CASE id ${caseClauses} END,
                    lastValueUpdatedAt = :operationTime
                WHERE id IN (:tagIds)
            `, {
                replacements: { 
                    tagIds,
                    operationTime 
                },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            });
            console.log(`✅ (EMS) Updated ${tagValueInserts.length} Tags.currentValue entries (bulk UPDATE)`);
        }

        // Commit transaction BEFORE sending response
        await transaction.commit();

        // Check and trigger notifications (async, non-blocking) - AFTER transaction commit (EMS)
        setImmediate(() => {
            checkAndTriggerNotifications(tagOperationsForNotificationsEMS, operationTime)
                .catch(err => console.error('❌ EMS Notification check failed:', err.message));
        });

        res.status(201).json({
            message: "EMS bulk tag operations completed successfully",
            summary: {
                operationTime,
                tagsProcessed: Object.keys(tags).length,
                specialTagsProcessed: 0, // No special processing for EMS
                jobsForRecalculation: 0, // No jobs for EMS
                jobsDeferred: 0, // No jobs for EMS
                metadata: {
                    type: "energy_meter",
                    productionStatus: "N/A"
                }
            },
            tagOperations: Object.entries(tags).map(([tagId, value]) => ({
                tagId: parseInt(tagId),
                value,
                createdAt: operationTime
            }))
        });

    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error("Error in EMS bulk tag operations:", error);
        res.status(500).json({ 
            error: error.message,
            details: "EMS bulk tag operation failed and was rolled back"
        });
    }
};

/**
 * Bulk Tag Operations API for RIM L1 Line
 * Creates multiple tag values for RIM L1 line in a single transaction
 * 
 * @param {Object} req.body - Request body containing:
 *   - createdAt: Timestamp for the operation (optional, defaults to current time)
 *   - tags: Object containing ALL tag operations { tagId: value, tagId: value, ... }
 *          Including special tags like prog (187) and batchactive (182)
 * 
 * Example request body:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "182": 1,    // RIM L1_Batch_Active (batchactive)
 *     "187": 1,    // RIM L1_Filler_WS_Cur_Prog (prog)
 *     ...
 *   }
 * }
 */
exports.createBulkTagOperationsRIM = async (req, res) => {//RIM L1
    const transaction = await sequelize.transaction();
    try {
        const { createdAt, tags } = req.body;

        // Validation
        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: "Tags object is required and must contain at least one tag operation" 
            });
        }

        // Extract prog and batchactive from tags for RIM L1
        // Tag 187 = prog (RIM L1_Filler_WS_Cur_Prog), Tag 182 = batchactive (RIM L1_Batch_Active)
        const prog = tags['187'] || 1;  // RIM L1_Filler_WS_Cur_Prog
        const batchactive = tags['182'] || 0;  // RIM L1_Batch_Active

        // Use provided timestamp or current time
        const operationTime = createdAt ? 
            moment(createdAt).format("YYYY-MM-DD HH:mm:ss") : 
            moment().format("YYYY-MM-DD HH:mm:ss");
        
        const utcNow = moment.utc(operationTime).format("YYMMDDHHmm");

        // Prepare arrays for batch operations
        const tagValueInserts = [];
        const specialTagOperations = [];
        const tagNotifications = [];

        // Pre-fetch all tags we're working with
        const tagIds = Object.keys(tags).map(id => parseInt(id));
        const tagMap = new Map();
        
        const allTags = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            transaction
        });

        allTags.forEach(tag => tagMap.set(tag.id, tag));

        // Fetch previous tag values for notification comparison (RIM L1)
        // USE TAGS.currentValue instead of querying TagValues (60,000x faster!)
        const previousValuesRIM = {};
        const tagsWithCurrentValuesRIM = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            attributes: ['id', 'currentValue'],
            transaction
        });
        
        tagsWithCurrentValuesRIM.forEach(tag => {
            previousValuesRIM[tag.id] = tag.currentValue;
        });
        console.log(`🔍 (RIM L1) Fetched ${tagsWithCurrentValuesRIM.length} previous tag values from Tags.currentValue`);

        // Process each tag operation
        for (const [tagIdStr, value] of Object.entries(tags)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);

            if (!tag) {
                await transaction.rollback();
                return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
            }

            // Validate that this is NOT a meter tag (accepts line and machine tags)
            if (tag.taggableType === "meter") {
                await transaction.rollback();
                return res.status(400).json({ 
                    error: `Tag ${tagId} (${tag.name}) is a meter tag. Meter tags are not allowed in RIM production endpoints. Use /api/bulk-tag-operations/rim-ems for meter tags.` 
                });
            }

            // Prepare tag value for batch insert
            tagValueInserts.push({
                tagId,
                value,
                createdAt: operationTime,
                updatedAt: operationTime
            });

            // Prepare notification
            tagNotifications.push({ tagId, value, timestamp: operationTime });

            // Check if this is a special tag that requires additional processing for RIM L1
            if (tag.ref === TagRefs.BATCH_ACTIVE || tag.ref === TagRefs.CURRENT_PROGRAM) {
                // Validate type for special tags
                if (tag.taggableType !== "line") {
                    throw new Error(`Tag with ref '${tag.ref}' must be linked to a line. Found type: '${tag.taggableType}'`);
                }
                
                specialTagOperations.push({ tag, value, tagId });
            }
        }

        // Bulk insert all tag values with upsert capability
        await TagValues.bulkCreate(tagValueInserts, {
            transaction,
            updateOnDuplicate: ['value', 'updatedAt']
        });

        // Prepare tag operations for notification checking (RIM L1)
        const tagOperationsForNotificationsRIM = tagValueInserts.map(tv => {
            const oldValue = previousValuesRIM[tv.tagId] || null;
            console.log(`🔍 DEBUG: TagId ${tv.tagId} - newValue: ${tv.value} (type: ${typeof tv.value}), oldValue: ${oldValue} (type: ${typeof oldValue})`);
            return {
                tagId: tv.tagId,
                value: tv.value,
                oldValue: oldValue
            };
        });

        // Process special tag operations (programs and jobs) for RIM L1
        const jobsToRecalculate = new Set();
        
        // Sort special operations: programs first, then batch operations
        const programOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.CURRENT_PROGRAM);
        const batchOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.BATCH_ACTIVE);
        
        // Process programs first
        for (const { tag, value } of programOperations) {
            await processSpecialTagOperationRIM(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }
        
        // Then process batch operations
        for (const { tag, value } of batchOperations) {
            await processSpecialTagOperationRIM(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }

        // Update Tags.currentValue with new values (RIM L1 - SINGLE bulk UPDATE - 50% cheaper!)
        if (tagValueInserts.length > 0) {
            const tagIds = tagValueInserts.map(tv => tv.tagId);
            const caseClauses = tagValueInserts.map(tv => 
                `WHEN ${tv.tagId} THEN '${tv.value.toString().replace(/'/g, "''")}'`
            ).join(' ');
            
            await sequelize.query(`
                UPDATE Tags
                SET 
                    currentValue = CASE id ${caseClauses} END,
                    lastValueUpdatedAt = :operationTime
                WHERE id IN (:tagIds)
            `, {
                replacements: { 
                    tagIds,
                    operationTime 
                },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            });
            console.log(`✅ (RIM L1) Updated ${tagValueInserts.length} Tags.currentValue entries (bulk UPDATE)`);
        }

        // Commit transaction BEFORE sending response
        await transaction.commit();

        // Check and trigger notifications (async, non-blocking) - AFTER transaction commit (RIM L1)
        setImmediate(() => {
            checkAndTriggerNotifications(tagOperationsForNotificationsRIM, operationTime)
                .catch(err => console.error('❌ RIM L1 Notification check failed:', err.message));
        });

        // Mark activity for RIM L1 when at least one item was processed
        if (tagValueInserts.length > 0) {
            setImmediate(() => {
                try {
                    const monitor = getFeedInactivityMonitor();
                    monitor.markLastSeen('rim-l1');
                } catch (e) {
                    console.error('FeedInactivityMonitor RIM L1 markLastSeen failed:', e.message);
                }
            });
        }

        // Queue recalculation for affected jobs ONLY when production stops (prog = 0) - OUTSIDE transaction
        if (jobsToRecalculate.size > 0 && prog === 0) {
            console.log(`🔄 RIM L1 Production stopped (prog=0) - Queuing recalculation for ${jobsToRecalculate.size} jobs...`);
            
            const recalculationPromises = Array.from(jobsToRecalculate).map(jobId => 
                handleRecalculation(jobId).catch(err => 
                    console.error(`❌ Failed to queue recalculation for job ${jobId}:`, err.message)
                )
            );
            
            await Promise.allSettled(recalculationPromises);
        } else if (jobsToRecalculate.size > 0) {
            console.log(`⏸️  RIM L1 Production active (prog=${prog}) - Deferring recalculation for ${jobsToRecalculate.size} jobs until production stops`);
        }

        res.status(201).json({
            message: "RIM L1 bulk tag operations completed successfully",
            summary: {
                operationTime,
                tagsProcessed: Object.keys(tags).length,
                specialTagsProcessed: specialTagOperations.length,
                jobsForRecalculation: prog === 0 ? jobsToRecalculate.size : 0,
                jobsDeferred: prog !== 0 ? jobsToRecalculate.size : 0,
                metadata: {
                    prog,
                    batchactive,
                    productionStatus: prog === 1 ? "active" : "stopped",
                    line: "RIM L1"
                }
            },
            tagOperations: Object.entries(tags).map(([tagId, value]) => ({
                tagId: parseInt(tagId),
                value,
                createdAt: operationTime
            }))
        });

    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error("Error in RIM L1 bulk tag operations:", error);
        res.status(500).json({ 
            error: error.message,
            details: "RIM L1 bulk tag operation failed and was rolled back"
        });
    }
};

/**
 * Bulk Tag Operations API for RIM L3 Line (Bardi-23-L3, Line 26)
 * Creates multiple tag values for RIM L3 line in a single transaction
 * Note: This function processes Line 26 which is actually L3 (Bardi-23-L3)
 * 
 * @param {Object} req.body - Request body containing:
 *   - createdAt: Timestamp for the operation (optional, defaults to current time)
 *   - tags: Object containing ALL tag operations { tagId: value, tagId: value, ... }
 *          Including special tags like prog and batchactive
 * 
 * Example request body:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "274": 1,    // RIM L3_Batch_Active (batchactive) - Line 26 (L3)
 *     "292": 1,    // RIM L3_Washer&Filler_WS_Cur_Prog (prog) - Line 26 (L3)
 *     ...
 *   }
 * }
 */
exports.createBulkTagOperationsRIML2 = async (req, res) => {//RIM L2
    const transaction = await sequelize.transaction();
    try {
        const { createdAt, tags } = req.body;

        // Validation
        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: "Tags object is required and must contain at least one tag operation" 
            });
        }

        // Extract prog and batchactive from tags for RIM L3 (Line 26 - Bardi-23-L3)
        // Tag 292 = prog (RIM L3_Washer&Filler_WS_Cur_Prog - line 26, ref='prgm')
        // Tag 274 = batchactive (RIM L3_Batch_Active - line 26, ref='bac')
        const prog = tags['292'] || 1;  // RIM L3_Washer&Filler_WS_Cur_Prog
        const batchactive = tags['274'] || 0;  // RIM L3_Batch_Active

        // Use provided timestamp or current time
        const operationTime = createdAt ? 
            moment(createdAt).format("YYYY-MM-DD HH:mm:ss") : 
            moment().format("YYYY-MM-DD HH:mm:ss");
        
        const utcNow = moment.utc(operationTime).format("YYMMDDHHmm");

        // Prepare arrays for batch operations
        const tagValueInserts = [];
        const specialTagOperations = [];
        const tagNotifications = [];

        // Pre-fetch all tags we're working with
        const tagIds = Object.keys(tags).map(id => parseInt(id));
        const tagMap = new Map();
        
        const allTags = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            transaction
        });

        allTags.forEach(tag => tagMap.set(tag.id, tag));

        // Fetch previous tag values for notification comparison (RIM L2)
        // USE TAGS.currentValue instead of querying TagValues (60,000x faster!)
        const previousValuesRIML2 = {};
        const tagsWithCurrentValuesRIML2 = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            attributes: ['id', 'currentValue'],
            transaction
        });
        
        tagsWithCurrentValuesRIML2.forEach(tag => {
            previousValuesRIML2[tag.id] = tag.currentValue;
        });
        console.log(`🔍 (RIM L2) Fetched ${tagsWithCurrentValuesRIML2.length} previous tag values from Tags.currentValue`);

        // Process each tag operation
        for (const [tagIdStr, value] of Object.entries(tags)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);

            if (!tag) {
                await transaction.rollback();
                return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
            }

            // Validate that this is NOT a meter tag (accepts line and machine tags)
            if (tag.taggableType === "meter") {
                await transaction.rollback();
                return res.status(400).json({ 
                    error: `Tag ${tagId} (${tag.name}) is a meter tag. Meter tags are not allowed in RIM production endpoints. Use /api/bulk-tag-operations/rim-ems for meter tags.` 
                });
            }

            // Prepare tag value for batch insert
            tagValueInserts.push({
                tagId,
                value,
                createdAt: operationTime,
                updatedAt: operationTime
            });

            // Prepare notification
            tagNotifications.push({ tagId, value, timestamp: operationTime });

            // Check if this is a special tag that requires additional processing for RIM L2
            if (tag.ref === TagRefs.BATCH_ACTIVE || tag.ref === TagRefs.CURRENT_PROGRAM) {
                // Validate type for special tags
                if (tag.taggableType !== "line") {
                    throw new Error(`Tag with ref '${tag.ref}' must be linked to a line. Found type: '${tag.taggableType}'`);
                }
                
                specialTagOperations.push({ tag, value, tagId });
            }
        }

        // Bulk insert all tag values with upsert capability
        await TagValues.bulkCreate(tagValueInserts, {
            transaction,
            updateOnDuplicate: ['value', 'updatedAt']
        });

        // Prepare tag operations for notification checking (RIM L2)
        const tagOperationsForNotificationsRIML2 = tagValueInserts.map(tv => {
            const oldValue = previousValuesRIML2[tv.tagId] || null;
            console.log(`🔍 DEBUG: TagId ${tv.tagId} - newValue: ${tv.value} (type: ${typeof tv.value}), oldValue: ${oldValue} (type: ${typeof oldValue})`);
            return {
                tagId: tv.tagId,
                value: tv.value,
                oldValue: oldValue
            };
        });

        // Process special tag operations (programs and jobs) for RIM L2
        const jobsToRecalculate = new Set();
        
        // Sort special operations: programs first, then batch operations
        const programOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.CURRENT_PROGRAM);
        const batchOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.BATCH_ACTIVE);
        
        // Process programs first
        for (const { tag, value } of programOperations) {
            await processSpecialTagOperationRIML2(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }
        
        // Then process batch operations
        for (const { tag, value } of batchOperations) {
            await processSpecialTagOperationRIML2(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }

        // Update Tags.currentValue with new values (RIM L2 - SINGLE bulk UPDATE - 50% cheaper!)
        if (tagValueInserts.length > 0) {
            const tagIds = tagValueInserts.map(tv => tv.tagId);
            const caseClauses = tagValueInserts.map(tv => 
                `WHEN ${tv.tagId} THEN '${tv.value.toString().replace(/'/g, "''")}'`
            ).join(' ');
            
            await sequelize.query(`
                UPDATE Tags
                SET 
                    currentValue = CASE id ${caseClauses} END,
                    lastValueUpdatedAt = :operationTime
                WHERE id IN (:tagIds)
            `, {
                replacements: { 
                    tagIds,
                    operationTime 
                },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            });
            console.log(`✅ (RIM L2) Updated ${tagValueInserts.length} Tags.currentValue entries (bulk UPDATE)`);
        }

        // Commit transaction BEFORE sending response
        await transaction.commit();

        // Check and trigger notifications (async, non-blocking) - AFTER transaction commit (RIM L2)
        setImmediate(() => {
            checkAndTriggerNotifications(tagOperationsForNotificationsRIML2, operationTime)
                .catch(err => console.error('❌ RIM L2 Notification check failed:', err.message));
        });

        // Mark activity for RIM L2 when at least one item was processed
        if (tagValueInserts.length > 0) {
            setImmediate(() => {
                try {
                    const monitor = getFeedInactivityMonitor();
                    monitor.markLastSeen('rim-l2');
                } catch (e) {
                    console.error('FeedInactivityMonitor RIM L2 markLastSeen failed:', e.message);
                }
            });
        }

        // Queue recalculation for affected jobs ONLY when production stops (prog = 0) - OUTSIDE transaction
        if (jobsToRecalculate.size > 0 && prog === 0) {
            console.log(`🔄 RIM L2 Production stopped (prog=0) - Queuing recalculation for ${jobsToRecalculate.size} jobs...`);
            
            const recalculationPromises = Array.from(jobsToRecalculate).map(jobId => 
                handleRecalculation(jobId).catch(err => 
                    console.error(`❌ Failed to queue recalculation for job ${jobId}:`, err.message)
                )
            );
            
            await Promise.allSettled(recalculationPromises);
        } else if (jobsToRecalculate.size > 0) {
            console.log(`⏸️  RIM L3 (Line 26 - Bardi-23-L3) Production active (prog=${prog}) - Deferring recalculation for ${jobsToRecalculate.size} jobs until production stops`);
        }

        res.status(201).json({
            message: "RIM L3 bulk tag operations completed successfully",
            summary: {
                operationTime,
                tagsProcessed: Object.keys(tags).length,
                specialTagsProcessed: specialTagOperations.length,
                jobsForRecalculation: prog === 0 ? jobsToRecalculate.size : 0,
                jobsDeferred: prog !== 0 ? jobsToRecalculate.size : 0,
                metadata: {
                    prog,
                    batchactive,
                    productionStatus: prog === 1 ? "active" : "stopped",
                    line: "RIM L3"
                }
            },
            tagOperations: Object.entries(tags).map(([tagId, value]) => ({
                tagId: parseInt(tagId),
                value,
                createdAt: operationTime
            }))
        });

    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error("Error in RIM L3 (Line 26 - Bardi-23-L3) bulk tag operations:", error);
        res.status(500).json({ 
            error: error.message,
            details: "RIM L3 bulk tag operation failed and was rolled back"
        });
    }
};

/**
 * Process special tag operations for RIM L1 line (BATCH_ACTIVE and CURRENT_PROGRAM)
 * 
 * FIXED LOGIC (Same as KL1/BL2):
 * - Programs: Create only when prog=1 and no active program exists for the line
 * - Programs: Close only when prog=0 and active program exists for the line  
 * - Jobs: Create only when bac=1 and no active job exists for the line
 * - Jobs: Close when bac=0 OR when parent program closes
 */
async function processSpecialTagOperationRIM(tag, value, operationTime, utcNow, transaction, jobsToRecalculate, prog) {
    const lineId = tag.taggableId; // Should be 25 for RIM L1
    console.log(`🔧 RIM L1 Processing ${tag.ref} = ${value} for line ${lineId} (prog=${prog})`);

    if (tag.ref === TagRefs.BATCH_ACTIVE) {
        if (value === 1) {
            // Starting a batch - check if job already exists for this line
            const existingOpenJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction,
            });

            if (!existingOpenJob) {
                // Need to create a new job - find active program for this line
                const activeProgram = await Program.findOne({
                    where: { endDate: null, lineId },
                    order: [['startDate', 'DESC']],
                    transaction,
                });

                if (!activeProgram) {
                    throw new Error(`Cannot start a job: No active program found for RIM L1 line ${lineId}.`);
                }

                const line = await Line.findByPk(lineId, { attributes: ['name'], transaction });
                const lineName = line?.name || `Line_${lineId}`;
                const jobName = `${lineName}.Run_${utcNow}`;

                const newJob = await Job.create({
                    jobName,
                    actualStartTime: operationTime,
                    actualEndTime: null,
                    lineId,
                    programId: activeProgram.id,
                }, { transaction });

                console.log(`✅ Created new RIM L1 job ${newJob.id} for line ${lineId} under program ${activeProgram.id}`);
            } else {
                console.log(`🔄 RIM L1 Job ${existingOpenJob.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a batch - close the job for this line
            const openJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction
            });

            if (openJob) {
                await openJob.update({ actualEndTime: operationTime }, { transaction });

                // Handle recipe and SKU assignment
                await handleRecipeAssignmentRIM(openJob, operationTime, transaction);
                
                // Always mark for recalculation when job closes
                jobsToRecalculate.add(openJob.id);
                
                console.log(`✅ Closed RIM L1 job ${openJob.id} for line ${lineId} (batch ended)`);
            } else {
                console.log(`⚠️  No active RIM L1 job found to close for line ${lineId}`);
            }
        }

    } else if (tag.ref === TagRefs.CURRENT_PROGRAM) {
        if (value === 1) {
            // Starting a program - check if program already exists for this line
            const existingProgram = await Program.findOne({
                where: { endDate: null, lineId },
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (!existingProgram) {
                const line = await Line.findByPk(lineId, {
                    attributes: ['name'],
                    transaction
                });

                const lineName = line?.name || `Line_${lineId}`;
                const programName = `${lineName}_${utcNow}`;

                const newProgram = await Program.create({
                    number: programName,
                    programName,
                    description: `Started by bulk operation for RIM L1 tag ${tag.id}`,
                    startDate: operationTime,
                    endDate: null,
                    lineId,
                }, { transaction });

                console.log(`✅ Created new RIM L1 program ${newProgram.id} for line ${lineId}`);
            } else {
                console.log(`🔄 RIM L1 Program ${existingProgram.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a program - close program for this line
            const openProgram = await Program.findOne({
                where: { endDate: null, lineId },
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (openProgram) {
                await openProgram.update({ endDate: operationTime }, { transaction });
                console.log(`✅ Closed RIM L1 program ${openProgram.id} for line ${lineId}`);
                
                // When program closes, also close any open batch jobs connected to this program
                const openJob = await Job.findOne({
                    where: { 
                        actualEndTime: null, 
                        programId: openProgram.id,
                        lineId
                    },
                    order: [['actualStartTime', 'DESC']],
                    transaction
                });

                if (openJob) {
                    await openJob.update({ actualEndTime: operationTime }, { transaction });
                    
                    // Handle recipe and SKU assignment
                    await handleRecipeAssignmentRIM(openJob, operationTime, transaction);
                    
                    // Mark for recalculation since program is stopping
                    jobsToRecalculate.add(openJob.id);
                    
                    console.log(`✅ Closed RIM L1 job ${openJob.id} connected to program ${openProgram.id} when program ended`);
                }
            } else {
                console.log(`⚠️  No active RIM L1 program found to close for line ${lineId}`);
            }
        }
    }
}

/**
 * Process special tag operations for RIM L2 line (BATCH_ACTIVE and CURRENT_PROGRAM)
 * 
 * FIXED LOGIC (Same as KL1/BL2/RIM L1):
 * - Programs: Create only when prog=1 and no active program exists for the line
 * - Programs: Close only when prog=0 and active program exists for the line  
 * - Jobs: Create only when bac=1 and no active job exists for the line
 * - Jobs: Close when bac=0 OR when parent program closes
 */
async function processSpecialTagOperationRIML2(tag, value, operationTime, utcNow, transaction, jobsToRecalculate, prog) {
    const lineId = tag.taggableId; // Should be 26 for RIM L2
    console.log(`🔧 RIM L2 Processing ${tag.ref} = ${value} for line ${lineId} (prog=${prog})`);

    if (tag.ref === TagRefs.BATCH_ACTIVE) {
        if (value === 1) {
            // Starting a batch - check if job already exists for this line
            const existingOpenJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction,
            });

            if (!existingOpenJob) {
                // Need to create a new job - find active program for this line
                const activeProgram = await Program.findOne({
                    where: { endDate: null, lineId },
                    order: [['startDate', 'DESC']],
                    transaction,
                });

                if (!activeProgram) {
                    throw new Error(`Cannot start a job: No active program found for RIM L2 line ${lineId}.`);
                }

                const line = await Line.findByPk(lineId, { attributes: ['name'], transaction });
                const lineName = line?.name || `Line_${lineId}`;
                const jobName = `${lineName}.Run_${utcNow}`;

                const newJob = await Job.create({
                    jobName,
                    actualStartTime: operationTime,
                    actualEndTime: null,
                    lineId,
                    programId: activeProgram.id,
                }, { transaction });

                console.log(`✅ Created new RIM L2 job ${newJob.id} for line ${lineId} under program ${activeProgram.id}`);
            } else {
                console.log(`🔄 RIM L2 Job ${existingOpenJob.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a batch - close the job for this line
            const openJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction
            });

            if (openJob) {
                await openJob.update({ actualEndTime: operationTime }, { transaction });

                // Handle recipe and SKU assignment
                await handleRecipeAssignmentRIML2(openJob, operationTime, transaction);
                
                // Always mark for recalculation when job closes
                jobsToRecalculate.add(openJob.id);
                
                console.log(`✅ Closed RIM L2 job ${openJob.id} for line ${lineId} (batch ended)`);
            } else {
                console.log(`⚠️  No active RIM L2 job found to close for line ${lineId}`);
            }
        }

    } else if (tag.ref === TagRefs.CURRENT_PROGRAM) {
        if (value === 1) {
            // Starting a program - check if program already exists for this line
            const existingProgram = await Program.findOne({
                where: { endDate: null, lineId },
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (!existingProgram) {
                const line = await Line.findByPk(lineId, {
                    attributes: ['name'],
                    transaction
                });

                const lineName = line?.name || `Line_${lineId}`;
                const programName = `${lineName}_${utcNow}`;

                const newProgram = await Program.create({
                    number: programName,
                    programName,
                    description: `Started by bulk operation for RIM L2 tag ${tag.id}`,
                    startDate: operationTime,
                    endDate: null,
                    lineId,
                }, { transaction });

                console.log(`✅ Created new RIM L2 program ${newProgram.id} for line ${lineId}`);
            } else {
                console.log(`🔄 RIM L2 Program ${existingProgram.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a program - close program for this line
            const openProgram = await Program.findOne({
                where: { endDate: null, lineId },
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (openProgram) {
                await openProgram.update({ endDate: operationTime }, { transaction });
                console.log(`✅ Closed RIM L2 program ${openProgram.id} for line ${lineId}`);
                
                // When program closes, also close any open batch jobs connected to this program
                const openJob = await Job.findOne({
                    where: { 
                        actualEndTime: null, 
                        programId: openProgram.id,
                        lineId
                    },
                    order: [['actualStartTime', 'DESC']],
                    transaction
                });

                if (openJob) {
                    await openJob.update({ actualEndTime: operationTime }, { transaction });
                    
                    // Handle recipe and SKU assignment
                    await handleRecipeAssignmentRIML2(openJob, operationTime, transaction);
                    
                    // Mark for recalculation since program is stopping
                    jobsToRecalculate.add(openJob.id);
                    
                    console.log(`✅ Closed RIM L2 job ${openJob.id} connected to program ${openProgram.id} when program ended`);
                }
            } else {
                console.log(`⚠️  No active RIM L2 program found to close for line ${lineId}`);
            }
        }
    }
}

/**
 * Handle recipe assignment for completed RIM L1 jobs
 */
async function handleRecipeAssignmentRIM(job, operationTime, transaction) {
    try {
        const recipeTag = await Tags.findOne({
            where: {
                ref: TagRefs.RECIPE,
                taggableType: 'line',
                taggableId: job.lineId
            },
            transaction
        });

        if (recipeTag) {
            const latestRecipeTagVal = await TagValues.findOne({
                where: {
                    tagId: recipeTag.id,
                    createdAt: { [Op.lte]: operationTime }
                },
                order: [['createdAt', 'DESC']],
                transaction
            });

            if (latestRecipeTagVal) {
                const recipeNumber = parseInt(latestRecipeTagVal.value);

                const recipe = await sequelize.query(
                    `SELECT r.id, r.skuId 
                     FROM recipes r
                     JOIN linerecipies lr ON r.id = lr.recipieId  
                     WHERE r.number = :recipeNumber 
                     AND lr.lineId = :lineId 
                     LIMIT 1`,
                    {
                        replacements: { recipeNumber, lineId: job.lineId },
                        type: sequelize.QueryTypes.SELECT,
                        transaction
                    }
                );

                if (recipe.length > 0 && recipe[0].skuId) {
                    await job.update({ skuId: recipe[0].skuId }, { transaction });
                    console.log(`✅ Assigned SKU ${recipe[0].skuId} to RIM L1 job ${job.id} from recipe ${recipeNumber}`);
                }
            }
        }
    } catch (error) {
        console.error(`⚠️ Error handling recipe assignment for RIM L1 job ${job.id}:`, error.message);
        // Don't throw here - we don't want to fail the entire operation for recipe assignment issues
    }
}

/**
 * Handle recipe assignment for completed RIM L2 jobs
 */
async function handleRecipeAssignmentRIML2(job, operationTime, transaction) {
    try {
        const recipeTag = await Tags.findOne({
            where: {
                ref: TagRefs.RECIPE,
                taggableType: 'line',
                taggableId: job.lineId
            },
            transaction
        });

        if (recipeTag) {
            const latestRecipeTagVal = await TagValues.findOne({
                where: {
                    tagId: recipeTag.id,
                    createdAt: { [Op.lte]: operationTime }
                },
                order: [['createdAt', 'DESC']],
                transaction
            });

            if (latestRecipeTagVal) {
                const recipeNumber = parseInt(latestRecipeTagVal.value);

                const recipe = await sequelize.query(
                    `SELECT r.id, r.skuId 
                     FROM recipes r
                     JOIN linerecipies lr ON r.id = lr.recipieId  
                     WHERE r.number = :recipeNumber 
                     AND lr.lineId = :lineId 
                     LIMIT 1`,
                    {
                        replacements: { recipeNumber, lineId: job.lineId },
                        type: sequelize.QueryTypes.SELECT,
                        transaction
                    }
                );

                if (recipe.length > 0 && recipe[0].skuId) {
                    await job.update({ skuId: recipe[0].skuId }, { transaction });
                    console.log(`✅ Assigned SKU ${recipe[0].skuId} to RIM L2 job ${job.id} from recipe ${recipeNumber}`);
                }
            }
        }
    } catch (error) {
        console.error(`⚠️ Error handling recipe assignment for RIM L2 job ${job.id}:`, error.message);
        // Don't throw here - we don't want to fail the entire operation for recipe assignment issues
    }
}

/**
 * Bulk Tag Operations API for RIM L2 Line (Bardi-10-L2, Line 27)
 * Creates multiple tag values for RIM L2 line in a single transaction
 * Note: This function processes Line 27 which is actually L2 (Bardi-10-L2)
 * 
 * @param {Object} req.body - Request body containing:
 *   - createdAt: Timestamp for the operation (optional, defaults to current time)
 *   - tags: Object containing ALL tag operations { tagId: value, tagId: value, ... }
 *          Including special tags like prog and batchactive
 * 
 * Example request body:
 * {
 *   "createdAt": "2025-12-10T14:30:00.000Z",
 *   "tags": {
 *     "295": 1,    // L2_BatchActive (batchactive) - Line 27 (L2)
 *     "296": 1,    // L2_Program (prog) - Line 27 (L2)
 *     ...
 *   }
 * }
 */
exports.createBulkTagOperationsRIML3 = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { createdAt, tags } = req.body;

        // Validation
        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: "Tags object is required and must contain at least one tag operation" 
            });
        }

        // Extract prog and batchactive from tags for RIM L2 (Line 27 - Bardi-10-L2)
        // Tag 296 = prog (L2_Program - line 27, ref='prgm')
        // Tag 295 = batchactive (L2_BatchActive - line 27, ref='bac')
        const prog = tags['296'] || 1;  // L2_Program
        const batchactive = tags['295'] || 0;  // L2_BatchActive

        // Use provided timestamp or current time
        const operationTime = createdAt ? 
            moment(createdAt).format("YYYY-MM-DD HH:mm:ss") : 
            moment().format("YYYY-MM-DD HH:mm:ss");
        
        const utcNow = moment.utc(operationTime).format("YYMMDDHHmm");

        // Prepare arrays for batch operations
        const tagValueInserts = [];
        const specialTagOperations = [];
        const tagNotifications = [];

        // Pre-fetch all tags we're working with
        const tagIds = Object.keys(tags).map(id => parseInt(id));
        const tagMap = new Map();
        
        const allTags = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            transaction
        });

        allTags.forEach(tag => tagMap.set(tag.id, tag));

        // Fetch previous tag values for notification comparison (RIM L3)
        // USE TAGS.currentValue instead of querying TagValues (60,000x faster!)
        const previousValuesRIML3 = {};
        const tagsWithCurrentValuesRIML3 = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            attributes: ['id', 'currentValue'],
            transaction
        });
        
        tagsWithCurrentValuesRIML3.forEach(tag => {
            previousValuesRIML3[tag.id] = tag.currentValue;
        });
        console.log(`🔍 (RIM L3) Fetched ${tagsWithCurrentValuesRIML3.length} previous tag values from Tags.currentValue`);

        // Process each tag operation
        for (const [tagIdStr, value] of Object.entries(tags)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);

            if (!tag) {
                await transaction.rollback();
                return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
            }

            // Validate that this is NOT a meter tag (accepts line and machine tags)
            if (tag.taggableType === "meter") {
                await transaction.rollback();
                return res.status(400).json({ 
                    error: `Tag ${tagId} (${tag.name}) is a meter tag. Meter tags are not allowed in RIM production endpoints. Use /api/bulk-tag-operations/rim-ems for meter tags.` 
                });
            }

            // Prepare tag value for batch insert
            tagValueInserts.push({
                tagId,
                value,
                createdAt: operationTime,
                updatedAt: operationTime
            });

            // Prepare notification
            tagNotifications.push({ tagId, value, timestamp: operationTime });

            // Check if this is a special tag that requires additional processing for RIM L3
            if (tag.ref === TagRefs.BATCH_ACTIVE || tag.ref === TagRefs.CURRENT_PROGRAM) {
                // Validate type for special tags
                if (tag.taggableType !== "line") {
                    throw new Error(`Tag with ref '${tag.ref}' must be linked to a line. Found type: '${tag.taggableType}'`);
                }
                
                specialTagOperations.push({ tag, value, tagId });
            }
        }

        // Bulk insert all tag values with upsert capability
        await TagValues.bulkCreate(tagValueInserts, {
            transaction,
            updateOnDuplicate: ['value', 'updatedAt']
        });

        // Prepare tag operations for notification checking (RIM L3)
        const tagOperationsForNotificationsRIML3 = tagValueInserts.map(tv => {
            const oldValue = previousValuesRIML3[tv.tagId] || null;
            console.log(`🔍 DEBUG: TagId ${tv.tagId} - newValue: ${tv.value} (type: ${typeof tv.value}), oldValue: ${oldValue} (type: ${typeof oldValue})`);
            return {
                tagId: tv.tagId,
                value: tv.value,
                oldValue: oldValue
            };
        });

        // Process special tag operations (programs and jobs) for RIM L3
        const jobsToRecalculate = new Set();
        
        // Sort special operations: programs first, then batch operations
        const programOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.CURRENT_PROGRAM);
        const batchOperations = specialTagOperations.filter(op => op.tag.ref === TagRefs.BATCH_ACTIVE);
        
        // Process programs first
        for (const { tag, value } of programOperations) {
            await processSpecialTagOperationRIML3(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }
        
        // Then process batch operations
        for (const { tag, value } of batchOperations) {
            await processSpecialTagOperationRIML3(
                tag, 
                value, 
                operationTime, 
                utcNow, 
                transaction, 
                jobsToRecalculate,
                prog
            );
        }

        // Update Tags.currentValue with new values (RIM L3 - SINGLE bulk UPDATE - 50% cheaper!)
        if (tagValueInserts.length > 0) {
            const tagIds = tagValueInserts.map(tv => tv.tagId);
            const caseClauses = tagValueInserts.map(tv => 
                `WHEN ${tv.tagId} THEN '${tv.value.toString().replace(/'/g, "''")}'`
            ).join(' ');
            
            await sequelize.query(`
                UPDATE Tags
                SET 
                    currentValue = CASE id ${caseClauses} END,
                    lastValueUpdatedAt = :operationTime
                WHERE id IN (:tagIds)
            `, {
                replacements: { 
                    tagIds,
                    operationTime 
                },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            });
            console.log(`✅ (RIM L3) Updated ${tagValueInserts.length} Tags.currentValue entries (bulk UPDATE)`);
        }

        // Commit transaction BEFORE sending response
        await transaction.commit();

        // Check and trigger notifications (async, non-blocking) - AFTER transaction commit (RIM L3)
        setImmediate(() => {
            checkAndTriggerNotifications(tagOperationsForNotificationsRIML3, operationTime)
                .catch(err => console.error('❌ RIM L3 Notification check failed:', err.message));
        });

        // Mark activity for RIM L3 when at least one item was processed
        if (tagValueInserts.length > 0) {
            setImmediate(() => {
                try {
                    const monitor = getFeedInactivityMonitor();
                    monitor.markLastSeen('rim-l3');
                } catch (e) {
                    console.error('FeedInactivityMonitor RIM L3 markLastSeen failed:', e.message);
                }
            });
        }

        // Queue recalculation for affected jobs ONLY when production stops (prog = 0) - OUTSIDE transaction
        if (jobsToRecalculate.size > 0 && prog === 0) {
            console.log(`🔄 RIM L3 Production stopped (prog=0) - Queuing recalculation for ${jobsToRecalculate.size} jobs...`);
            
            const recalculationPromises = Array.from(jobsToRecalculate).map(jobId => 
                handleRecalculation(jobId).catch(err => 
                    console.error(`❌ Failed to queue recalculation for job ${jobId}:`, err.message)
                )
            );
            
            await Promise.allSettled(recalculationPromises);
        } else if (jobsToRecalculate.size > 0) {
            console.log(`⏸️  RIM L2 (Line 27 - Bardi-10-L2) Production active (prog=${prog}) - Deferring recalculation for ${jobsToRecalculate.size} jobs until production stops`);
        }

        res.status(201).json({
            message: "RIM L2 bulk tag operations completed successfully",
            summary: {
                operationTime,
                tagsProcessed: Object.keys(tags).length,
                specialTagsProcessed: specialTagOperations.length,
                jobsForRecalculation: prog === 0 ? jobsToRecalculate.size : 0,
                jobsDeferred: prog !== 0 ? jobsToRecalculate.size : 0,
                metadata: {
                    prog,
                    batchactive,
                    productionStatus: prog === 1 ? "active" : "stopped",
                    line: "RIM L2"
                }
            },
            tagOperations: Object.entries(tags).map(([tagId, value]) => ({
                tagId: parseInt(tagId),
                value,
                createdAt: operationTime
            }))
        });

    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error("Error in RIM L2 (Line 27 - Bardi-10-L2) bulk tag operations:", error);
        res.status(500).json({ 
            error: error.message,
            details: "RIM L2 bulk tag operation failed and was rolled back"
        });
    }
};

/**
 * Process special tag operations for RIM L3 line (BATCH_ACTIVE and CURRENT_PROGRAM)
 * 
 * FIXED LOGIC (Same as KL1/BL2/RIM L1/RIM L2):
 * - Programs: Create only when prog=1 and no active program exists for the line
 * - Programs: Close only when prog=0 and active program exists for the line  
 * - Jobs: Create only when bac=1 and no active job exists for the line
 * - Jobs: Close when bac=0 OR when parent program closes
 */
async function processSpecialTagOperationRIML3(tag, value, operationTime, utcNow, transaction, jobsToRecalculate, prog) {
    const lineId = tag.taggableId; // Should be 27 for RIM L3
    console.log(`🔧 RIM L3 Processing ${tag.ref} = ${value} for line ${lineId} (prog=${prog})`);

    if (tag.ref === TagRefs.BATCH_ACTIVE) {
        if (value === 1) {
            // Starting a batch - check if job already exists for this line
            const existingOpenJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction,
            });

            if (!existingOpenJob) {
                // Need to create a new job - find active program for this line
                const activeProgram = await Program.findOne({
                    where: { endDate: null, lineId },
                    order: [['startDate', 'DESC']],
                    transaction,
                });

                if (!activeProgram) {
                    throw new Error(`Cannot start a job: No active program found for RIM L3 line ${lineId}.`);
                }

                const line = await Line.findByPk(lineId, { attributes: ['name'], transaction });
                const lineName = line?.name || `Line_${lineId}`;
                const jobName = `${lineName}.Run_${utcNow}`;

                const newJob = await Job.create({
                    jobName,
                    actualStartTime: operationTime,
                    actualEndTime: null,
                    lineId,
                    programId: activeProgram.id,
                }, { transaction });

                console.log(`✅ Created new RIM L3 job ${newJob.id} for line ${lineId} under program ${activeProgram.id}`);
            } else {
                console.log(`🔄 RIM L3 Job ${existingOpenJob.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a batch - close the job for this line
            const openJob = await Job.findOne({
                where: { actualEndTime: null, lineId },
                order: [['actualStartTime', 'DESC']],
                transaction
            });

            if (openJob) {
                await openJob.update({ actualEndTime: operationTime }, { transaction });

                // Handle recipe and SKU assignment
                await handleRecipeAssignmentRIML3(openJob, operationTime, transaction);
                
                // Always mark for recalculation when job closes
                jobsToRecalculate.add(openJob.id);
                
                console.log(`✅ Closed RIM L3 job ${openJob.id} for line ${lineId} (batch ended)`);
            } else {
                console.log(`⚠️  No active RIM L3 job found to close for line ${lineId}`);
            }
        }

    } else if (tag.ref === TagRefs.CURRENT_PROGRAM) {
        if (value === 1) {
            // Starting a program - check if program already exists for this line
            const existingProgram = await Program.findOne({
                where: { endDate: null, lineId },
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (!existingProgram) {
                const line = await Line.findByPk(lineId, {
                    attributes: ['name'],
                    transaction
                });

                const lineName = line?.name || `Line_${lineId}`;
                const programName = `${lineName}_${utcNow}`;

                const newProgram = await Program.create({
                    number: programName,
                    programName,
                    description: `Started by bulk operation for RIM L3 tag ${tag.id}`,
                    startDate: operationTime,
                    endDate: null,
                    lineId,
                }, { transaction });

                console.log(`✅ Created new RIM L3 program ${newProgram.id} for line ${lineId}`);
            } else {
                console.log(`🔄 RIM L3 Program ${existingProgram.id} already active for line ${lineId} - keeping it running`);
            }

        } else if (value === 0) {
            // Ending a program - close program for this line
            const openProgram = await Program.findOne({
                where: { endDate: null, lineId },
                order: [['startDate', 'DESC']],
                transaction,
            });

            if (openProgram) {
                await openProgram.update({ endDate: operationTime }, { transaction });
                console.log(`✅ Closed RIM L3 program ${openProgram.id} for line ${lineId}`);
                
                // When program closes, also close any open batch jobs connected to this program
                const openJob = await Job.findOne({
                    where: { 
                        actualEndTime: null, 
                        programId: openProgram.id,
                        lineId
                    },
                    order: [['actualStartTime', 'DESC']],
                    transaction
                });

                if (openJob) {
                    await openJob.update({ actualEndTime: operationTime }, { transaction });
                    
                    // Handle recipe and SKU assignment
                    await handleRecipeAssignmentRIML3(openJob, operationTime, transaction);
                    
                    // Mark for recalculation since program is stopping
                    jobsToRecalculate.add(openJob.id);
                    
                    console.log(`✅ Closed RIM L3 job ${openJob.id} connected to program ${openProgram.id} when program ended`);
                }
            } else {
                console.log(`⚠️  No active RIM L3 program found to close for line ${lineId}`);
            }
        }
    }
}

/**
 * Handle recipe assignment for completed RIM L3 jobs
 */
async function handleRecipeAssignmentRIML3(job, operationTime, transaction) {
    try {
        const recipeTag = await Tags.findOne({
            where: {
                ref: TagRefs.RECIPE,
                taggableType: 'line',
                taggableId: job.lineId
            },
            transaction
        });

        if (recipeTag) {
            const latestRecipeTagVal = await TagValues.findOne({
                where: {
                    tagId: recipeTag.id,
                    createdAt: { [Op.lte]: operationTime }
                },
                order: [['createdAt', 'DESC']],
                transaction
            });

            if (latestRecipeTagVal) {
                const recipeNumber = parseInt(latestRecipeTagVal.value);

                const recipe = await sequelize.query(
                    `SELECT r.id, r.skuId 
                     FROM recipes r
                     JOIN linerecipies lr ON r.id = lr.recipieId  
                     WHERE r.number = :recipeNumber 
                     AND lr.lineId = :lineId 
                     LIMIT 1`,
                    {
                        replacements: { recipeNumber, lineId: job.lineId },
                        type: sequelize.QueryTypes.SELECT,
                        transaction
                    }
                );

                if (recipe.length > 0 && recipe[0].skuId) {
                    await job.update({ skuId: recipe[0].skuId }, { transaction });
                    console.log(`✅ Assigned SKU ${recipe[0].skuId} to RIM L3 job ${job.id} from recipe ${recipeNumber}`);
                }
            }
        }
    } catch (error) {
        console.error(`⚠️ Error handling recipe assignment for RIM L3 job ${job.id}:`, error.message);
        // Don't throw here - we don't want to fail the entire operation for recipe assignment issues
    }
}

/**
 * Bulk Tag Operations API for RIM EMS Energy
 * Creates multiple tag values for RIM energy meters in a single transaction
 * No special processing - just simple tag value inserts
 * 
 * @param {Object} req.body - Request body containing:
 *   - createdAt: Timestamp for the operation (optional, defaults to current time)
 *   - tags: Object containing meter tag operations { tagId: value, tagId: value, ... }
 * 
 * Example request body:
 * {
 *   "createdAt": "2025-12-16T10:00:00.000Z",
 *   "tags": {
 *     "348": 1250.5,  // Krones2_Blower_kwh
 *     "349": 980.2,   // Krones2_Kwh
 *     "350": 750.8,   // G1_kWh
 *     "351": 1100.3,  // G2_kWh
 *     "352": 920.4,   // G3_kWh
 *     "353": 1050.7,  // G4_kWh
 *     "354": 880.9,   // G5_kWh
 *     "355": 1200.1   // G6_kWh
 *   }
 * }
 */
exports.createBulkTagOperationsRIMEMS = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { createdAt, tags } = req.body;

        // Validation
        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
            await transaction.rollback();
            return res.status(400).json({ 
                error: "Tags object is required and must contain at least one tag operation" 
            });
        }

        // Use provided timestamp or current time
        const operationTime = createdAt ? 
            moment(createdAt).format("YYYY-MM-DD HH:mm:ss") : 
            moment().format("YYYY-MM-DD HH:mm:ss");

        // Prepare arrays for batch operations
        const tagValueInserts = [];
        const tagNotifications = [];

        // Pre-fetch all tags we're working with
        const tagIds = Object.keys(tags).map(id => parseInt(id));
        const tagMap = new Map();
        
        const allTags = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            transaction
        });

        allTags.forEach(tag => tagMap.set(tag.id, tag));

        // Fetch previous tag values for notification comparison (RIM EMS)
        // USE TAGS.currentValue instead of querying TagValues (60,000x faster!)
        const previousValuesRIMEMS = {};
        const tagsWithCurrentValuesRIMEMS = await Tags.findAll({
            where: { id: { [Op.in]: tagIds } },
            attributes: ['id', 'currentValue'],
            transaction
        });
        
        tagsWithCurrentValuesRIMEMS.forEach(tag => {
            previousValuesRIMEMS[tag.id] = tag.currentValue;
        });
        console.log(`🔍 (RIM EMS) Fetched ${tagsWithCurrentValuesRIMEMS.length} previous tag values from Tags.currentValue`);

        // Process each tag operation
        for (const [tagIdStr, value] of Object.entries(tags)) {
            const tagId = parseInt(tagIdStr);
            const tag = tagMap.get(tagId);

            if (!tag) {
                await transaction.rollback();
                return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
            }

            // Validate that this is a meter tag (should be linked to a meter)
            if (tag.taggableType !== "meter") {
                await transaction.rollback();
                return res.status(400).json({ 
                    error: `Tag ${tagId} (${tag.name}) is not a meter tag. Expected taggableType: 'meter', found: '${tag.taggableType}'` 
                });
            }

            // Prepare tag value for batch insert
            tagValueInserts.push({
                tagId,
                value,
                createdAt: operationTime,
                updatedAt: operationTime
            });

            // Prepare notification
            tagNotifications.push({ tagId, value, timestamp: operationTime });
        }

        // Bulk insert all tag values with upsert capability
        await TagValues.bulkCreate(tagValueInserts, {
            transaction,
            updateOnDuplicate: ['value', 'updatedAt']
        });

        // Prepare tag operations for notification checking (RIM EMS)
        const tagOperationsForNotificationsRIMEMS = tagValueInserts.map(tv => ({
            tagId: tv.tagId,
            value: tv.value,
            oldValue: previousValuesRIMEMS[tv.tagId] || null
        }));

        // Update Tags.currentValue with new values (RIM EMS - SINGLE bulk UPDATE - 50% cheaper!)
        if (tagValueInserts.length > 0) {
            const tagIds = tagValueInserts.map(tv => tv.tagId);
            const caseClauses = tagValueInserts.map(tv => 
                `WHEN ${tv.tagId} THEN '${tv.value.toString().replace(/'/g, "''")}'`
            ).join(' ');
            
            await sequelize.query(`
                UPDATE Tags
                SET 
                    currentValue = CASE id ${caseClauses} END,
                    lastValueUpdatedAt = :operationTime
                WHERE id IN (:tagIds)
            `, {
                replacements: { 
                    tagIds,
                    operationTime 
                },
                type: sequelize.QueryTypes.UPDATE,
                transaction
            });
            console.log(`✅ (RIM EMS) Updated ${tagValueInserts.length} Tags.currentValue entries (bulk UPDATE)`);
        }

        // Commit transaction BEFORE sending response
        await transaction.commit();

        // Check and trigger notifications (async, non-blocking) - AFTER transaction commit (RIM EMS)
        setImmediate(() => {
            checkAndTriggerNotifications(tagOperationsForNotificationsRIMEMS, operationTime)
                .catch(err => console.error('❌ RIM EMS Notification check failed:', err.message));
        });

        // Mark activity for RIM EMS when at least one item was processed
        if (tagValueInserts.length > 0) {
            setImmediate(() => {
                try {
                    const monitor = getFeedInactivityMonitor();
                    monitor.markLastSeen('rim-ems');
                } catch (e) {
                    console.error('FeedInactivityMonitor RIM EMS markLastSeen failed:', e.message);
                }
            });
        }

        res.status(201).json({
            message: "RIM EMS bulk tag operations completed successfully",
            summary: {
                operationTime,
                tagsProcessed: Object.keys(tags).length,
                specialTagsProcessed: 0, // No special processing for RIM EMS
                jobsForRecalculation: 0, // No jobs for RIM EMS
                jobsDeferred: 0, // No jobs for RIM EMS
                metadata: {
                    type: "rim_energy_meter",
                    productionStatus: "N/A"
                }
            },
            tagOperations: Object.entries(tags).map(([tagId, value]) => ({
                tagId: parseInt(tagId),
                value,
                createdAt: operationTime
            }))
        });

    } catch (error) {
        // Only rollback if transaction hasn't been committed yet
        if (!transaction.finished) {
            await transaction.rollback();
        }
        console.error("Error in RIM EMS bulk tag operations:", error);
        res.status(500).json({ 
            error: error.message,
            details: "RIM EMS bulk tag operation failed and was rolled back"
        });
    }
};

module.exports = exports;
