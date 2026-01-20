const { Program, Job, Line , Tags, AlarmAggregation, MachineStateAggregation, TagValues, Sku, OEETimeSeries, sequelize } = require("../dbInit");

const { recalculateAggregatesForJob } = require("../utils/modules");
const correlationLogger = require("../utils/correlationLogger");

// Lazy load queue to avoid connection issues during startup
let recalculationQueue = null;
const getRecalculationQueue = () => {
  if (!recalculationQueue) {
    recalculationQueue = require("../utils/queues/recalculationQueue");
  }
  return recalculationQueue;
};

const { getGlobalJobNotificationService } = require("../utils/services/GlobalJobNotificationService");
const { getJobStatusService } = require("../utils/services/JobStatusService");

const { Op } = require("sequelize");
 
const moment = require("moment");

// Removed external lookback; we now constrain search strictly to the job duration

// Detect environment
const isProduction = process.env.NODE_ENV === 'production';
const isAzureRedis = process.env.REDIS_HOST && (process.env.REDIS_HOST.includes('azure') || process.env.REDIS_HOST.includes('redis.cache.windows.net'));

// Helper function to handle recalculation based on environment
async function handleRecalculation(jobId, transaction = null) {
    // Use Bull queue for both local and Azure environments
    console.log(`🔄 Adding job ${jobId} to recalculation queue`);
    try {
        const queue = getRecalculationQueue();
        if (!queue) {
            throw new Error('Queue instance is null - queue not initialized');
        }
        
        // Check if queue is paused before adding
        const isPaused = await queue.isPaused();
        if (isPaused) {
            console.warn(`⚠️ Queue is PAUSED - job will be queued but not processed until resumed`);
        }
        
        console.log(`📋 Queue instance: OK, paused: ${isPaused}`);
        
        // Add job with timeout to prevent hanging
        const job = await Promise.race([
            queue.add({ jobId }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Queue add timeout after 10s')), 10000)
            )
        ]);
        
        console.log(`✅ Job added to queue successfully - Queue Job ID: ${job.id}`);
        return job;
    } catch (error) {
        console.error(`❌ ERROR adding job ${jobId} to queue:`, error.message);
        console.error(`❌ Error stack:`, error.stack);
        
        // Log additional diagnostics
        try {
            const queue = getRecalculationQueue();
            if (queue) {
                const counts = await queue.getJobCounts();
                console.error(`❌ Queue counts at time of error:`, counts);
            }
        } catch (diagError) {
            console.error(`❌ Failed to get diagnostic info:`, diagError.message);
        }
        
        throw error;
    }
}

// Helper function to assign SKU to job based on recipe tag
async function assignSkuToJob(job, jobStartTime, transaction) {
    try {
        console.log(`🔍 DEBUG assignSkuToJob: Starting for job ${job.id}, lineId ${job.lineId}, time ${jobStartTime}`);
        // STEP 1: Find "rcpn" tag for the job's line
        const recipeTag = await Tags.findOne({
            where: {
                ref: 'rcpn',
                taggableId: job.lineId
            },
            transaction
        });
        console.log(`🔍 DEBUG assignSkuToJob: Recipe tag found:`, recipeTag ? { id: recipeTag.id, name: recipeTag.name } : 'NOT FOUND');

        if (recipeTag) {
            // STEP 2: Get the latest NON-ZERO value within the job duration window
            // Define window: [job.actualStartTime, job.actualEndTime || jobStartTime]
            const windowStart = new Date(job.actualStartTime || jobStartTime);
            const windowEnd = new Date(job.actualEndTime || jobStartTime);

            const recipeTagValue = await TagValues.findOne({
                where: {
                    tagId: recipeTag.id,
                    createdAt: {
                        [Op.gte]: windowStart,
                        [Op.lte]: windowEnd,
                    },
                    value: { [Op.ne]: '0' },
                },
                order: [['createdAt', 'DESC']],
                transaction,
            });

            // STEP 3: Map recipe value to SKU.id through recipes table
            if (recipeTagValue && recipeTagValue.value && recipeTagValue.value !== '0') {
                const recipeNumber = parseInt(recipeTagValue.value);
                console.log(`🔍 DEBUG assignSkuToJob: Recipe number from tag (non-zero): ${recipeNumber}`);
                console.log(`🔍 DEBUG assignSkuToJob: Query params - recipeNumber: '${recipeNumber.toString()}', lineId: ${job.lineId}`);

                const recipe = await sequelize.query(
                    `SELECT r.id, r.skuId 
                     FROM recipes r
                     JOIN linerecipies lr ON r.id = lr.recipieId  
                     WHERE r.number = :recipeNumber 
                     AND lr.lineId = :lineId 
                     LIMIT 1`,
                    {
                        replacements: { recipeNumber: recipeNumber.toString(), lineId: job.lineId },
                        type: sequelize.QueryTypes.SELECT,
                        transaction
                    }
                );
                console.log(`🔍 DEBUG assignSkuToJob: Recipe query result:`, recipe);

                if (recipe.length > 0 && recipe[0].skuId) {
                    console.log(`🔍 DEBUG assignSkuToJob: Updating job skuId from ${job.skuId} to ${recipe[0].skuId}`);
                    job.skuId = recipe[0].skuId;
                    await job.save({ transaction });
                    console.log(`✅ DEBUG assignSkuToJob: Job saved successfully`);
                    return recipe[0].skuId;
                } else {
                    console.log(`⚠️ DEBUG assignSkuToJob: No recipe found or no skuId in recipe`);
                }
            } else {
                console.log(`⚠️ DEBUG assignSkuToJob: No non-zero recipe tag value found in window ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);
            }
        }
        
        // If no SKU found through recipe tag, return null
        return null;
    } catch (error) {
        console.error("Error assigning SKU to job:", error);
        return null;
    }
}

// Helper function to validate SKU assignment
async function validateSkuAssignment(job, operation) {
    if (!job.skuId) {
        throw new Error(`Job ${job.id} (${job.jobName}) created during ${operation} operation has no SKU assigned. This may indicate missing recipe tag data or SKU mapping.`);
    }
}

// Validation endpoint to check for jobs without SKUs
exports.validateJobSkus = async (req, res) => {
    try {
        const jobsWithoutSku = await Job.findAll({
            where: {
                skuId: null
            },
            include: [
                { model: Program, as: 'program', attributes: ['programName', 'startDate', 'endDate'] },
                { model: Line, as: 'line', attributes: ['name'] }
            ],
            order: [['createdAt', 'DESC']]
        });

        const validationResult = {
            totalJobsWithoutSku: jobsWithoutSku.length,
            jobs: jobsWithoutSku.map(job => ({
                id: job.id,
                jobName: job.jobName,
                actualStartTime: job.actualStartTime,
                actualEndTime: job.actualEndTime,
                lineName: job.line?.name || `Line_${job.lineId}`,
                programName: job.program?.programName,
                programStart: job.program?.startDate,
                programEnd: job.program?.endDate,
                createdAt: job.createdAt
            }))
        };

        res.status(200).json(validationResult);
    } catch (err) {
        console.error("Error validating job SKUs:", err);
        res.status(500).json({ message: "Failed to validate job SKUs" });
    }
};

// Get running production runs by line ID (endDate IS NULL)
exports.getRunningProductionRunsByLine = async (req, res) => {
    try {
        const { lineId } = req.params;

        // Validate lineId
        if (!lineId || isNaN(parseInt(lineId))) {
            return res.status(400).json({ 
                message: "Invalid line ID provided",
                data: []
            });
        }

        // Query only running programs (endDate IS NULL) for the specified line
        const programs = await Program.findAll({
            where: {
                lineId: parseInt(lineId),
                endDate: null, // Only running programs
                startDate: { [Op.ne]: null } // Must have started
            },
            include: { 
                model: Job, 
                as: "jobs", 
                required: false 
            },
            order: [["startDate", "DESC"]], // Most recent first
        });

        // Flatten structure similar to getAllProductionRuns
        const flattened = programs.flatMap((program) =>
            (program.jobs || []).map((job, index) => {
                return {
                    id: `${program.id}-${job.id || index}`,
                    programId: program.id,
                    jobId: job.id,
                    programName: program.programName,
                    programStart: program.startDate,
                    jobName: job.jobName,
                    jobStart: job.actualStartTime,
                    jobEnd: job.actualEndTime,
                    programEnd: program.endDate, // This will always be null for running programs
                    skuId: job.skuId,
                    hasSku: !!job.skuId,
                    status: 'running', // All results are running by definition
                    isActive: true,
                    isCompleted: false,
                    isPending: false
                };
            })
        );

        res.status(200).json({
            data: flattened,
            lineId: parseInt(lineId),
            count: flattened.length
        });
    } catch (err) {
        console.error("Error fetching running production runs by line:", err);
        res.status(500).json({ 
            message: "Failed to fetch running production runs",
            data: []
        });
    }
};

// Enhanced getAllProductionRuns with SKU validation
exports.getAllProductionRuns = async (req, res) => {
    try {
        const programs = await Program.findAll({
            include: { model: Job, as: "jobs", required: false },
            order: [["startDate", "ASC"]],
        });

        const flattened = programs.flatMap((program) =>
            (program.jobs || []).map((job, index) => {
                // Determine status based on program dates
                let status = 'pending';
                if (program.startDate) {
                    if (program.endDate) {
                        status = 'completed';
                    } else {
                        status = 'running'; // Started but not ended = active/running
                    }
                }

                return {
                    id: `${program.id}-${job.id || index}`,
                    programId: program.id,
                    jobId: job.id, // Add jobId to the flattened object
                    programName: program.programName,
                    programStart: program.startDate,
                    jobName: job.jobName,
                    jobStart: job.actualStartTime,
                    jobEnd: job.actualEndTime,
                    programEnd: program.endDate,
                    skuId: job.skuId, // Include SKU ID for validation
                    hasSku: !!job.skuId, // Boolean flag for easy filtering
                    status: status, // Explicit status field
                    isActive: status === 'running', // Boolean flag for active runs
                    isCompleted: status === 'completed',
                    isPending: status === 'pending'
                };
            })
        );

        // Add validation summary
        const jobsWithoutSku = flattened.filter(item => !item.hasSku);
        const validationSummary = {
            totalJobs: flattened.length,
            jobsWithSku: flattened.length - jobsWithoutSku.length,
            jobsWithoutSku: jobsWithoutSku.length,
            hasIssues: jobsWithoutSku.length > 0,
            // Add job IDs with program names for jobs without SKU
            jobIdsWithoutSku: jobsWithoutSku.map(item => ({
                jobId: item.jobId,
                programName: item.programName
            })).filter(item => item.jobId),
            // Add status breakdown for better insights
            statusBreakdown: {
                completed: flattened.filter(item => item.status === 'completed').length,
                running: flattened.filter(item => item.status === 'running').length,
                pending: flattened.filter(item => item.status === 'pending').length
            }
        };

        res.status(200).json({
            data: flattened,
            validation: validationSummary
        });
    } catch (err) {
        console.error("Error fetching production runs:", err);
        res.status(500).json({ message: "Failed to fetch production runs" });
    }
};

exports.updateProductionRun = async (req, res) => {
    const transaction = await Program.sequelize.transaction();
    let jobIdForRecalculation = null; // Track job ID for recalculation outside transaction
    
    try {
        const { id } = req.params;
        const {
            programName, programStart, programEnd,
            jobName, jobStart, jobEnd,
            mergeConfirmed
        } = req.body;

        const program = await Program.findByPk(id, {
            include: { model: Job, as: "jobs" },
            transaction,
        });

        if (!program) {
            await transaction.rollback();
            return res.status(404).json({ message: "Program not found" });
        }

        const job = program.jobs[0];
        const originalProgramEnd = new Date(program.endDate);
        const originalJobEnd = job ? new Date(job.actualEndTime) : null;
        const originalProgramStart = new Date(program.startDate);
        const originalJobStart = job ? new Date(job.actualStartTime) : null;

        const conflictPrograms = await Program.findAll({
            where: {
                id: { [Op.ne]: program.id },
                startDate: { [Op.lte]: new Date(programEnd) },
                endDate: { [Op.gte]: new Date(programStart) },
                lineId: program.lineId,
            },
            include: { model: Job, as: "jobs" },
            transaction,
        });

        if (conflictPrograms.length > 0 && !mergeConfirmed) {
            // Get SKU information for all jobs involved in the merge
            const allConflictJobs = conflictPrograms.flatMap(cp => cp.jobs || []);
            const allJobs = [job, ...allConflictJobs];
            const skuIds = allJobs.map(j => j.skuId).filter(Boolean);
            const uniqueSkuIds = [...new Set(skuIds)];
            
            // Fetch SKU details for all unique SKUs
            const skus = await Sku.findAll({
                where: { id: uniqueSkuIds },
                transaction,
            });
            
            // Calculate merged program end (latest end date among all programs)
            const allProgramEnds = [new Date(programEnd), ...conflictPrograms.map(cp => new Date(cp.endDate))];
            const newProgramEnd = new Date(Math.max(...allProgramEnds));
            
            // Calculate merged job start/end times
            const allJobStarts = [new Date(job.actualStartTime), ...allConflictJobs.map(j => new Date(j.actualStartTime))];
            const allJobEnds = [new Date(job.actualEndTime), ...allConflictJobs.map(j => new Date(j.actualEndTime))];
            const mergedJobStart = new Date(Math.min(...allJobStarts));
            const mergedJobEnd = new Date(Math.max(...allJobEnds));
            
            await transaction.rollback();
            return res.status(409).json({
                message: "Conflict detected. Merge confirmation required.",
                conflictProgramIds: conflictPrograms.map(cp => cp.id),
                conflictPrograms: conflictPrograms.map(cp => ({
                    id: cp.id,
                    programName: cp.programName,
                    startDate: cp.startDate,
                    endDate: cp.endDate,
                    jobCount: cp.jobs ? cp.jobs.length : 0
                })),
                newProgramEnd: newProgramEnd,
                mergedJobStart: mergedJobStart,
                mergedJobEnd: mergedJobEnd,
                mergeRequired: true,
                availableSkus: skus.map(sku => ({
                    id: sku.id,
                    name: sku.name,
                    description: sku.description
                })),
                currentJobSku: job.skuId,
                conflictJobSkus: allConflictJobs.map(j => j.skuId).filter(Boolean)
            });
        }

        if (conflictPrograms.length > 0 && mergeConfirmed) {
            const { selectedSkuId } = req.body;
            await handleMergeUpdate({
                program, conflictPrograms, job,
                programName, programStart, programEnd,
                jobName, selectedSkuId, transaction
            });
            await transaction.commit();
            
            // Move recalculation outside transaction
            if (job && job.id) {
                console.log(`🔄 Triggering recalculation for merged job ${job.id} (${job.jobName}) with new end date`);
                try {
                    await handleRecalculation(job.id);
                    console.log("✅ Successfully processed recalculation (merge):", job.id);
                } catch (recalcError) {
                    console.error("❌ Failed to process recalculation (merge):", recalcError);
                    // Don't fail the request if recalculation fails
                }
            } else {
                console.log("⚠️ No job ID for recalculation (merge) - job:", job);
            }
            
            return res.status(200).json({ message: "Merged and updated successfully." });
        }

        await applyStandardUpdate({
            program, job,
            programName, programStart, programEnd,
            jobName, jobStart, jobEnd,
            originalProgramStart, originalProgramEnd,
            originalJobStart, originalJobEnd,
            transaction
        });

        // Store job ID for recalculation outside transaction
        if (job && job.id) {
            jobIdForRecalculation = job.id;
        }

        await transaction.commit();
        
                        // Move recalculation outside transaction to prevent timeout
                if (jobIdForRecalculation) {
                    try {
                        await handleRecalculation(jobIdForRecalculation);
                        console.log("✅ Successfully processed recalculation for job:", jobIdForRecalculation);
                    } catch (recalcError) {
                        console.error("❌ Failed to process recalculation:", recalcError);
                        // Don't fail the request if recalculation fails
                    }
                } else {
                    console.log("⚠️ No job ID for recalculation - jobIdForRecalculation:", jobIdForRecalculation);
                }
        
        res.status(200).json({ message: "Production run updated successfully." });
        return;
    } catch (error) {
        console.error("Error updating production run:", error);
        await transaction.rollback();
        return res.status(500).json({ message: "Error updating production run", error });
    }
};

exports.splitProductionRun = async (req, res) => {
    const transaction = await sequelize.transaction();
    const logger = req.logger || correlationLogger.child();
    
    let splitDetails = {
        originalProgramId: null,
        originalJobId: null,
        totalSplits: 0,
        successfulSplits: 0,
        failedSplits: [],
        errors: [],
        jobsForRecalculation: [] // Track job IDs for recalculation
    };
    
    try {
        logger.businessEvent('split_production_run_started', {
            programId: req.params.id,
            userId: req.userId,
            sessionId: req.sessionId
        });
        
        const { id } = req.params;
        const { originalProgramStart, originalProgramEnd, originalJobStart, originalJobEnd, splits } = req.body;

        // Validate input data
        logger.info('Split request validation', {
            programId: id,
            splitsCount: splits ? splits.length : 0,
            splits: splits ? splits.map(s => ({
                programStart: s.programStart,
                programEnd: s.programEnd,
                jobStart: s.jobStart,
                jobEnd: s.jobEnd
            })) : []
        });

        if (!splits || !Array.isArray(splits) || splits.length === 0) {
            logger.error('Invalid splits data provided', {
                splits: splits,
                splitsType: typeof splits,
                splitsLength: splits ? splits.length : 'undefined'
            });
            throw new Error("Invalid splits data: splits must be a non-empty array");
        }

        splitDetails.totalSplits = splits.length;
        logger.info('Processing splits', {
            totalSplits: splitDetails.totalSplits,
            programId: id
        });

        // Find original program
        logger.info('Looking for original program', { programId: id });
        const program = await Program.findByPk(id, { transaction });
        if (!program) {
            logger.error('Program not found', { programId: id });
            throw new Error(`Program not found with ID: ${id}`);
        }
        splitDetails.originalProgramId = program.id;
        logger.info('Found original program', {
            programId: program.id,
            programName: program.programName,
            lineId: program.lineId
        });

        // Find original job
        logger.info('Looking for original job', { programId: id });
        const job = await Job.findOne({ where: { programId: id }, transaction });
        if (!job) {
            logger.error('Job not found for program', { programId: id });
            throw new Error(`Job not found for program ID: ${id}`);
        }
        splitDetails.originalJobId = job.id;
        logger.info('Found original job', {
            jobId: job.id,
            jobName: job.jobName,
            skuId: job.skuId
        });

        const lineId = program.lineId;
        logger.info('Processing splits for line', { lineId });
        
        const line = await Line.findByPk(lineId, { attributes: ['name'], transaction });
        const lineName = line?.name || `Line_${lineId}`;
        logger.info('Line information retrieved', {
            lineId,
            lineName
        });

        // Validate original job has SKU
        logger.info('Original job SKU validation', {
            jobId: job.id,
            jobName: job.jobName,
            skuId: job.skuId,
            hasSku: !!job.skuId
        });

        // Delete job aggregates if job exists
        logger.info('Cleaning up job aggregates', { jobId: job.id });
        try {
            if (job) {
                const deletedAlarms = await AlarmAggregation.destroy({ where: { jobId: job.id }, transaction });
                const deletedMachineStates = await MachineStateAggregation.destroy({ where: { jobId: job.id }, transaction });
                const deletedOEETimeSeries = await OEETimeSeries.destroy({ where: { jobId: job.id }, transaction });
                logger.info('Aggregates deleted successfully', {
                    jobId: job.id,
                    deletedAlarms,
                    deletedMachineStates,
                    deletedOEETimeSeries
                });
            }
        } catch (aggregateError) {
            logger.error('Error deleting aggregates', {
                jobId: job.id,
                error: aggregateError.message,
                stack: aggregateError.stack
            });
            splitDetails.errors.push(`Failed to delete aggregates: ${aggregateError.message}`);
        }

        // Delete original records
        logger.info('Deleting original job and program', {
            programId: id,
            jobId: job.id
        });
        try {
            await Job.destroy({ where: { programId: id }, transaction });
            await Program.destroy({ where: { id }, transaction });
            logger.info('Original records deleted successfully', {
                programId: id,
                jobId: job.id
            });
        } catch (deleteError) {
            logger.error('Error deleting original records', {
                programId: id,
                jobId: job.id,
                error: deleteError.message,
                stack: deleteError.stack
            });
            throw new Error(`Failed to delete original records: ${deleteError.message}`);
        }

        // Sort splits by programStart to help with gap detection
        logger.info('Sorting splits by program start time', { splitsCount: splits.length });
        const sortedSplits = splits.sort((a, b) => new Date(a.programStart) - new Date(b.programStart));
        logger.info('Splits sorted successfully', {
            sortedSplits: sortedSplits.map((s, i) => ({
                index: i + 1,
                programStart: s.programStart,
                programEnd: s.programEnd
            }))
        });

        // Check for conflicts with existing production runs before creating splits
        logger.info('Checking for conflicts with existing production runs', { 
            lineId, 
            splitsCount: sortedSplits.length 
        });
        
        const allConflicts = [];
        
        for (let i = 0; i < sortedSplits.length; i++) {
            const split = sortedSplits[i];
            const splitIndex = i + 1;
            
            logger.info('Checking conflicts for split', {
                splitIndex,
                programStart: split.programStart,
                programEnd: split.programEnd
            });
            
            // Check if this split conflicts with any existing production runs
            const conflictPrograms = await Program.findAll({
                where: {
                    id: { [Op.ne]: id }, // Exclude the original program being split
                    startDate: { [Op.lte]: new Date(split.programEnd) },
                    endDate: { [Op.gte]: new Date(split.programStart) },
                    lineId: lineId,
                },
                include: { model: Job, as: "jobs" },
                transaction,
            });
            
            if (conflictPrograms.length > 0) {
                logger.warn('Conflicts found for split', {
                    splitIndex,
                    conflictCount: conflictPrograms.length,
                    conflicts: conflictPrograms.map(cp => ({
                        id: cp.id,
                        programName: cp.programName,
                        startDate: cp.startDate,
                        endDate: cp.endDate
                    }))
                });
                
                allConflicts.push({
                    splitIndex,
                    splitStart: split.programStart,
                    splitEnd: split.programEnd,
                    conflictPrograms: conflictPrograms.map(cp => ({
                        id: cp.id,
                        programName: cp.programName,
                        startDate: cp.startDate,
                        endDate: cp.endDate
                    }))
                });
            }
        }
        
        // If conflicts found, prevent split and return error
        if (allConflicts.length > 0) {
            logger.error('Split operation blocked due to conflicts', {
                totalConflicts: allConflicts.length,
                conflicts: allConflicts
            });
            
            await transaction.rollback();
            
            // Create detailed error message
            const conflictDetails = allConflicts.map(conflict => {
                const conflictList = conflict.conflictPrograms.map(cp => 
                    `${cp.programName} (${cp.startDate} - ${cp.endDate})`
                ).join(', ');
                return `Split ${conflict.splitIndex} (${conflict.splitStart} - ${conflict.splitEnd}) conflicts with: ${conflictList}`;
            }).join('\n');
            
            return res.status(409).json({
                message: "Split operation cannot proceed due to conflicts with existing production runs.",
                conflicts: allConflicts,
                conflictDetails: conflictDetails,
                recommendation: "Please resolve conflicts by either:\n1. Adjusting split dates to avoid overlaps\n2. Merging conflicting production runs first\n3. Deleting conflicting production runs if no longer needed"
            });
        }
        
        logger.info('No conflicts found, proceeding with split creation', { 
            splitsCount: sortedSplits.length 
        });

        // Insert new programs and jobs
        logger.businessEvent('creating_split_programs_jobs', {
            totalSplits: sortedSplits.length,
            programId: id,
            jobId: job.id
        });
        
        for (let i = 0; i < sortedSplits.length; i++) {
            const splitIndex = i + 1;
            logger.info('Processing individual split', {
                splitIndex,
                totalSplits: sortedSplits.length,
                progress: `${splitIndex}/${sortedSplits.length}`
            });
            
            try {
                const { programStart, programEnd, jobStart, jobEnd } = sortedSplits[i];
                
                // Validate split data
                logger.debug('Validating split data', {
                    splitIndex,
                    programStart,
                    programEnd,
                    jobStart,
                    jobEnd
                });

                if (!programStart || !programEnd || !jobStart || !jobEnd) {
                    logger.error('Split missing required fields', {
                        splitIndex,
                        programStart: !!programStart,
                        programEnd: !!programEnd,
                        jobStart: !!jobStart,
                        jobEnd: !!jobEnd
                    });
                    throw new Error(`Split ${splitIndex} missing required fields: programStart, programEnd, jobStart, jobEnd`);
                }

                // Validate date formats
                const programStartDate = new Date(programStart);
                const programEndDate = new Date(programEnd);
                const jobStartDate = new Date(jobStart);
                const jobEndDate = new Date(jobEnd);

                if (isNaN(programStartDate) || isNaN(programEndDate) || isNaN(jobStartDate) || isNaN(jobEndDate)) {
                    logger.error('Split has invalid date format', {
                        splitIndex,
                        programStart,
                        programEnd,
                        jobStart,
                        jobEnd,
                        programStartValid: !isNaN(programStartDate),
                        programEndValid: !isNaN(programEndDate),
                        jobStartValid: !isNaN(jobStartDate),
                        jobEndValid: !isNaN(jobEndDate)
                    });
                    throw new Error(`Split ${splitIndex} has invalid date format`);
                }

                if (programStartDate >= programEndDate) {
                    logger.error('Split program dates invalid', {
                        splitIndex,
                        programStart,
                        programEnd,
                        programStartDate: programStartDate.toISOString(),
                        programEndDate: programEndDate.toISOString()
                    });
                    throw new Error(`Split ${splitIndex}: programStart (${programStart}) must be before programEnd (${programEnd})`);
                }

                if (jobStartDate >= jobEndDate) {
                    logger.error('Split job dates invalid', {
                        splitIndex,
                        jobStart,
                        jobEnd,
                        jobStartDate: jobStartDate.toISOString(),
                        jobEndDate: jobEndDate.toISOString()
                    });
                    throw new Error(`Split ${splitIndex}: jobStart (${jobStart}) must be before jobEnd (${jobEnd})`);
                }

                // Use same naming convention as uploadTagValues
                const utcNow = moment.utc(programStart).format("YYMMDDHHmm");
                const generatedProgramName = `${lineName}_${utcNow}`;
                const generatedJobName = `${lineName}.Run_${utcNow}`;
                
                logger.info('Creating new program for split', {
                    splitIndex,
                    generatedProgramName,
                    programStart: programStartDate.toISOString(),
                    programEnd: programEndDate.toISOString(),
                    lineId
                });
                
                const newProgram = await Program.create({
                    programName: generatedProgramName,
                    number: generatedProgramName,
                    startDate: programStartDate,
                    endDate: programEndDate,
                    lineId: lineId
                }, { transaction });
                
                logger.info('Program created successfully', {
                    splitIndex,
                    programId: newProgram.id,
                    programName: generatedProgramName
                });

                logger.info('Creating new job for split', {
                    splitIndex,
                    generatedJobName,
                    jobStart: jobStartDate.toISOString(),
                    jobEnd: jobEndDate.toISOString(),
                    programId: newProgram.id,
                    lineId,
                    originalSkuId: job.skuId
                });
                
                const createdJob = await Job.create({
                    jobName: generatedJobName,
                    actualStartTime: jobStartDate,
                    actualEndTime: jobEndDate,
                    programId: newProgram.id,
                    lineId: lineId,
                    skuId: job.skuId // Start with original job's SKU as fallback
                }, { transaction });
                
                logger.info('Job created successfully', {
                    splitIndex,
                    jobId: createdJob.id,
                    jobName: generatedJobName,
                    programId: newProgram.id
                });
                
                // Try to assign SKU based on recipe tag at job start time
                logger.info('Assigning SKU to split job', {
                    splitIndex,
                    jobId: createdJob.id,
                    jobName: createdJob.jobName,
                    jobStartTime: jobStart
                });
                
                try {
                    const assignedSkuId = await assignSkuToJob(createdJob, jobStart, transaction);
                    logger.info('SKU assignment result', {
                        splitIndex,
                        jobId: createdJob.id,
                        assignedSkuId,
                        originalSkuId: job.skuId,
                        finalSkuId: createdJob.skuId
                    });
                    
                    // If no SKU assigned through recipe tag, validate that we have the original job's SKU
                    if (!assignedSkuId && !createdJob.skuId) {
                        logger.error('SKU assignment failed - no SKU found', {
                            splitIndex,
                            jobId: createdJob.id,
                            jobName: createdJob.jobName,
                            assignedSkuId,
                            originalSkuId: job.skuId
                        });
                        throw new Error(`Failed to assign SKU to split job ${createdJob.id} (${createdJob.jobName}). No recipe tag data found and original job had no SKU.`);
                    }
                    
                    // Validate SKU assignment
                    await validateSkuAssignment(createdJob, 'split');
                    logger.info('SKU validation passed', {
                        splitIndex,
                        jobId: createdJob.id,
                        skuId: createdJob.skuId
                    });
                    
                } catch (skuError) {
                    logger.error('SKU assignment error', {
                        splitIndex,
                        jobId: createdJob.id,
                        error: skuError.message,
                        stack: skuError.stack
                    });
                    throw new Error(`SKU assignment failed for split ${splitIndex}: ${skuError.message}`);
                }
                
                splitDetails.successfulSplits++;
                splitDetails.jobsForRecalculation.push(createdJob.id); // Track for recalculation
                logger.info('Split completed successfully', {
                    splitIndex,
                    totalSplits: sortedSplits.length,
                    progress: `${splitIndex}/${sortedSplits.length}`,
                    jobId: createdJob.id,
                    programId: newProgram.id
                });
                
            } catch (splitError) {
                logger.error('Error processing individual split', {
                    splitIndex,
                    error: splitError.message,
                    stack: splitError.stack,
                    splitData: sortedSplits[i]
                });
                
                splitDetails.failedSplits.push({
                    splitIndex,
                    error: splitError.message,
                    splitData: sortedSplits[i]
                });
                splitDetails.errors.push(`Split ${splitIndex} failed: ${splitError.message}`);
                
                // If this is a critical error, we might want to stop processing
                if (splitError.message.includes('SKU assignment failed') || 
                    splitError.message.includes('invalid date format') ||
                    splitError.message.includes('missing required fields')) {
                    logger.error('Critical error detected - stopping split processing', {
                        splitIndex,
                        error: splitError.message,
                        totalSplits: sortedSplits.length,
                        successfulSplits: splitDetails.successfulSplits
                    });
                    throw new Error(`Critical error in split ${splitIndex}: ${splitError.message}`);
                }
            }
        }

        logger.businessEvent('split_operation_summary', {
            totalSplits: splitDetails.totalSplits,
            successfulSplits: splitDetails.successfulSplits,
            failedSplits: splitDetails.failedSplits.length,
            errors: splitDetails.errors.length,
            originalProgramId: splitDetails.originalProgramId,
            originalJobId: splitDetails.originalJobId
        });

        if (splitDetails.failedSplits.length > 0) {
            logger.warn('Some splits failed during processing', {
                failedSplits: splitDetails.failedSplits,
                totalSplits: splitDetails.totalSplits,
                successRate: `${splitDetails.successfulSplits}/${splitDetails.totalSplits}`
            });
        }

        await transaction.commit();
        logger.info('Transaction committed successfully', {
            totalSplits: splitDetails.totalSplits,
            successfulSplits: splitDetails.successfulSplits
        });
        
        // Trigger recalculation for all created split jobs outside transaction
        if (splitDetails.jobsForRecalculation.length > 0) {
            logger.info('Triggering recalculation for split jobs', {
                jobIds: splitDetails.jobsForRecalculation,
                count: splitDetails.jobsForRecalculation.length
            });
            
            const recalculationPromises = splitDetails.jobsForRecalculation.map(jobId => 
                handleRecalculation(jobId).catch(err => 
                    logger.error(`Failed to queue recalculation for split job ${jobId}:`, err.message)
                )
            );
            
            await Promise.allSettled(recalculationPromises);
            logger.info('Recalculation queued for all split jobs', {
                totalJobs: splitDetails.jobsForRecalculation.length
            });
        }
        
        res.status(200).json({ 
            message: "Program successfully split.",
            details: {
                totalSplits: splitDetails.totalSplits,
                successfulSplits: splitDetails.successfulSplits,
                failedSplits: splitDetails.failedSplits.length,
                errors: splitDetails.errors,
                jobsForRecalculation: splitDetails.jobsForRecalculation.length
            }
        });

    } catch (error) {
        logger.errorWithContext(error, {
            operation: 'split_production_run',
            splitDetails,
            originalProgramId: splitDetails.originalProgramId,
            originalJobId: splitDetails.originalJobId,
            totalSplits: splitDetails.totalSplits,
            successfulSplits: splitDetails.successfulSplits,
            failedSplits: splitDetails.failedSplits
        });
        
        try {
            await transaction.rollback();
            logger.info('Transaction rolled back successfully', {
                operation: 'split_production_run',
                error: error.message
            });
        } catch (rollbackError) {
            logger.error('Error during transaction rollback', {
                operation: 'split_production_run',
                originalError: error.message,
                rollbackError: rollbackError.message,
                stack: rollbackError.stack
            });
        }
        
        res.status(500).json({ 
            message: "Error splitting program.", 
            error: error.message,
            details: splitDetails,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

async function handleMergeUpdate({
    program, conflictPrograms, job,
    programName, programStart, programEnd,
    jobName, selectedSkuId, transaction
}) {
    // Get line info for consistent naming
    const line = await Line.findByPk(program.lineId, { attributes: ['name'], transaction });
    const lineName = line?.name || `Line_${program.lineId}`;
    
    // Use same naming convention as uploadTagValues
    const utcNow = moment.utc(programStart).format("YYMMDDHHmm");
    const generatedProgramName = `${lineName}_${utcNow}`;
    const generatedJobName = `${lineName}.Run_${utcNow}`;
    
    // Calculate merged program end (latest end date among all programs)
    const allProgramEnds = [new Date(programEnd), ...conflictPrograms.map(cp => new Date(cp.endDate))];
    const newProgramEnd = new Date(Math.max(...allProgramEnds));
    
    // Get all jobs from all conflict programs
    const allConflictJobs = conflictPrograms.flatMap(cp => cp.jobs || []);
    const mergedJobs = [job, ...allConflictJobs];
    const mergedStart = new Date(Math.min(...mergedJobs.map(j => new Date(j.actualStartTime))));
    const mergedEnd = new Date(Math.max(...mergedJobs.map(j => new Date(j.actualEndTime))));
    
    await Program.update({
        programName: generatedProgramName,
        number: generatedProgramName, // Use generated name for number too
        startDate: new Date(programStart),
        endDate: newProgramEnd,
    }, {
        where: { id: program.id },
        transaction,
    });
    
    // Ensure we have a valid SKU for the merged job
    let finalSkuId = selectedSkuId || job.skuId;
    
    // If no SKU selected and original job has no SKU, try to assign based on recipe tag
    if (!finalSkuId) {
        const assignedSkuId = await assignSkuToJob(job, mergedStart, transaction);
        if (assignedSkuId) {
            finalSkuId = assignedSkuId;
        }
    }
    
    // Validate that we have a SKU before updating
    if (!finalSkuId) {
        throw new Error(`Failed to assign SKU to merged job ${job.id} (${job.jobName}). No SKU selected and no recipe tag data found.`);
    }
    
    await Job.update({
        jobName: generatedJobName,
        actualStartTime: mergedStart,
        actualEndTime: mergedEnd,
        skuId: finalSkuId
    }, {
        where: { id: job.id },
        transaction,
    });

    // Note: Recalculation will be handled outside transaction to avoid timeout

    // Delete ALL jobs from ALL conflict programs (they will be merged into the current job)
    const totalConflictJobs = conflictPrograms.reduce((total, cp) => total + (cp.jobs ? cp.jobs.length : 0), 0);
    console.log(`🗑️ Deleting ${totalConflictJobs} conflicting jobs from ${conflictPrograms.length} conflict programs`);
    
    for (const conflictProgram of conflictPrograms) {
        console.log(`🗑️ Processing conflict program ${conflictProgram.id} (${conflictProgram.programName}) with ${conflictProgram.jobs ? conflictProgram.jobs.length : 0} jobs`);
        
        for (const cj of conflictProgram.jobs || []) {
            console.log(`🗑️ Deleting aggregates for conflicting job ${cj.id} (${cj.jobName})`);
            
            // Delete all calculation aggregates for the conflicting job
            const deletedAlarms = await AlarmAggregation.destroy({ where: { jobId: cj.id }, transaction });
            const deletedMachineStates = await MachineStateAggregation.destroy({ where: { jobId: cj.id }, transaction });
            const deletedOEETimeSeries = await OEETimeSeries.destroy({ where: { jobId: cj.id }, transaction });
            
            console.log(`✅ Deleted aggregates for job ${cj.id}:`, {
                deletedAlarms,
                deletedMachineStates,
                deletedOEETimeSeries
            });
            
            // Delete the job itself
            await Job.destroy({ where: { id: cj.id }, transaction });
            console.log(`✅ Deleted conflicting job ${cj.id}`);
        }
        
        // Delete the entire conflict program
        await Program.destroy({ where: { id: conflictProgram.id }, transaction });
        console.log(`✅ Deleted conflict program ${conflictProgram.id} (${conflictProgram.programName})`);
    }
}

async function applyStandardUpdate({
    program, job,
    programName, programStart, programEnd,
    jobName, jobStart, jobEnd,
    originalProgramStart, originalProgramEnd,
    originalJobStart, originalJobEnd,
    transaction
}) {
    // ----- Program update (only update fields that were provided) -----
    if (program) {
        const line = await Line.findByPk(program.lineId, { attributes: ['name'], transaction });
        const lineName = line?.name || `Line_${program.lineId}`;

        const progUpdate = {};

        // If start provided, set it
        if (programStart) {
            progUpdate.startDate = new Date(programStart);
            if (isNaN(progUpdate.startDate)) {
                throw new Error(`Invalid programStart: ${programStart}`);
            }
        }

        // If end provided, set it
        if (programEnd) {
            progUpdate.endDate = new Date(programEnd);
            if (isNaN(progUpdate.endDate)) {
                throw new Error(`Invalid programEnd: ${programEnd}`);
            }
        }

        // If both provided, validate ordering
        if (progUpdate.startDate && progUpdate.endDate && progUpdate.startDate > progUpdate.endDate) {
            throw new Error(`Program start (${progUpdate.startDate.toISOString()}) is after end (${progUpdate.endDate.toISOString()})`);
        }

        // Naming: regenerate only if start provided (to follow your UTC timestamp convention)
        if (programStart) {
            const utcNow = moment.utc(programStart).format("YYMMDDHHmm");
            const generatedProgramName = `${lineName}_${utcNow}`;
            progUpdate.programName = generatedProgramName;
            progUpdate.number = generatedProgramName;
        } else if (programName) {
            // If caller explicitly provided a name, respect it
            progUpdate.programName = programName;
            progUpdate.number = programName;
        }

        if (Object.keys(progUpdate).length > 0) {
            await Program.update(progUpdate, {
                where: { id: program.id },
                transaction,
            });
        }
    }

    // ----- Job update (only update fields that were provided) -----
    if (job) {
        const line = await Line.findByPk(job.lineId, { attributes: ['name'], transaction });
        const lineName = line?.name || `Line_${job.lineId}`;

        const jobUpdate = {};
        let effectiveStart = job.actualStartTime;
        let effectiveEnd = job.actualEndTime;

        // Start time
        if (jobStart) {
            const js = new Date(jobStart);
            if (isNaN(js)) {
                throw new Error(`Invalid jobStart: ${jobStart}`);
            }
            jobUpdate.actualStartTime = js;
            effectiveStart = js;
        }

        // End time
        if (jobEnd) {
            const je = new Date(jobEnd);
            if (isNaN(je)) {
                throw new Error(`Invalid jobEnd: ${jobEnd}`);
            }
            jobUpdate.actualEndTime = je;
            effectiveEnd = je;
        }

        // If both in payload (or resolved), validate ordering
        if (effectiveStart && effectiveEnd && new Date(effectiveStart) > new Date(effectiveEnd)) {
            throw new Error(`Job start (${new Date(effectiveStart).toISOString()}) is after end (${new Date(effectiveEnd).toISOString()})`);
        }

        // Naming: regenerate only if start provided to follow your convention
        if (jobStart) {
            const utcNow = moment.utc(jobStart).format("YYMMDDHHmm");
            jobUpdate.jobName = `${lineName}.Run_${utcNow}`;
        } else if (jobName) {
            // Explicit override if caller provided
            jobUpdate.jobName = jobName;
        }

        // SKU logic:
        // - Always try to assign SKU via recipe tag (using jobStart if provided, or existing actualStartTime)
        // - If not found, keep existing SKU.
        // - If still missing, throw (same behavior you expect).
        let newSkuId = job.skuId;

        // Use provided jobStart or fall back to existing actualStartTime
        const timeForSkuAssignment = jobStart || job.actualStartTime;
        console.log(`🔍 DEBUG: Attempting SKU assignment for job ${job.id}, time: ${timeForSkuAssignment}, current skuId: ${job.skuId}`);
        if (timeForSkuAssignment) {
            const assignedSkuId = await assignSkuToJob(job, timeForSkuAssignment, transaction); // assigns & saves inside
            console.log(`🔍 DEBUG: assignSkuToJob returned: ${assignedSkuId}`);
            if (assignedSkuId) {
                newSkuId = assignedSkuId;
                console.log(`✅ DEBUG: SKU assigned successfully - old: ${job.skuId}, new: ${assignedSkuId}`);
            } else {
                console.log(`⚠️ DEBUG: assignSkuToJob returned null/undefined`);
            }
        }

        // If still no SKU, use existing (may have been set earlier in lifecycle)
        if (!newSkuId) {
            newSkuId = job.skuId;
        }

        if (!newSkuId) {
            throw new Error(`Failed to assign SKU to job ${job.id} (${job.jobName}) during update. No recipe tag data found and original job had no SKU.`);
        }

        jobUpdate.skuId = newSkuId;

        if (Object.keys(jobUpdate).length > 0) {
            await Job.update(jobUpdate, {
                where: { id: job.id },
                transaction,
            });
        }
    }
}

// Create new production run from currently running one
exports.createNewFromRunning = async (req, res) => {
    const transaction = await Program.sequelize.transaction();
    let oldJobIdForRecalculation = null;
    
    try {
        const { programId } = req.params;
        // Use UTC time consistently for all operations
        const currentTime = moment.utc().format("YYYY-MM-DD HH:mm:ss");
        console.log(`🕐 Current UTC time being used: ${currentTime}`);
        
        // Find the current running program with its jobs
        const currentProgram = await Program.findByPk(programId, {
            include: { model: Job, as: "jobs" },
            transaction,
        });

        if (!currentProgram) {
            await transaction.rollback();
            return res.status(404).json({ message: "Program not found" });
        }

        // Validate that the program is currently running
        if (currentProgram.endDate) {
            await transaction.rollback();
            return res.status(400).json({ message: "Program is not currently running" });
        }

        if (!currentProgram.startDate) {
            await transaction.rollback();
            return res.status(400).json({ message: "Program has not started yet" });
        }

        // Find the current running job
        const currentJob = currentProgram.jobs.find(job => !job.actualEndTime);
        if (!currentJob) {
            await transaction.rollback();
            return res.status(400).json({ message: "No active job found in the running program" });
        }

        // Get line information for naming
        const line = await Line.findByPk(currentProgram.lineId, { 
            attributes: ['name'], 
            transaction 
        });
        const lineName = line?.name || `Line_${currentProgram.lineId}`;

        // Generate names using current timestamp (UTC TIME)
        const utcNow = moment.utc().format("YYMMDDHHmm");
        const newProgramName = `${lineName}_${utcNow}`;
        const newJobName = `${lineName}.Run_${utcNow}`;

        console.log(`🔄 Creating new production run from running program ${programId}`);
        console.log(`📊 Current program: ${currentProgram.programName}, Current job: ${currentJob.jobName}`);
        console.log(`🆕 New program: ${newProgramName}, New job: ${newJobName}`);

        // Step 1: Close the current program and job
        await Program.update({
            endDate: currentTime,
        }, {
            where: { id: currentProgram.id },
            transaction,
        });

        await Job.update({
            actualEndTime: currentTime,
        }, {
            where: { id: currentJob.id },
            transaction,
        });

        console.log(`✅ Closed current program and job at ${currentTime}`);

        // Step 2: Create new program starting at the same moment
        const newProgram = await Program.create({
            programName: newProgramName,
            number: newProgramName,
            startDate: currentTime,
            endDate: null, // Running program
            lineId: currentProgram.lineId
        }, { transaction });

        console.log(`🆕 Created new program ${newProgram.id}: ${newProgramName}`);

        // Step 3: Create new job starting at the same moment
        const newJob = await Job.create({
            jobName: newJobName,
            actualStartTime: currentTime,
            actualEndTime: null, // Running job
            programId: newProgram.id,
            lineId: currentProgram.lineId,
            skuId: null // Will be assigned below
        }, { transaction });

        console.log(`🆕 Created new job ${newJob.id}: ${newJobName}`);

        // Step 4: Only assign SKU to the closed job, not the new running job
        console.log(`🔍 Assigning SKU to closed job ${currentJob.id} at its start time ${currentJob.actualStartTime}`);
        const closedJobAssignedSkuId = await assignSkuToJob(currentJob, currentJob.actualStartTime, transaction);
        
        if (!closedJobAssignedSkuId && !currentJob.skuId) {
            console.log(`⚠️ Closed job ${currentJob.id} has no SKU assigned`);
        } else if (closedJobAssignedSkuId) {
            console.log(`✅ Updated SKU for closed job ${currentJob.id} to ${closedJobAssignedSkuId}`);
        } else {
            console.log(`✅ Closed job ${currentJob.id} already has SKU ${currentJob.skuId}`);
        }

        // Step 5: New running job remains without SKU assignment until it's closed later
        console.log(`🔄 New running job ${newJob.id} will have SKU assigned when it's closed later`);

        // Step 6: Validate that only the closed job has SKU assigned (running job will be assigned later)
        const finalNewJob = await Job.findByPk(newJob.id, { transaction });
        const finalClosedJob = await Job.findByPk(currentJob.id, { transaction });
        
        // New running job should remain without SKU until closed later
        if (finalNewJob.skuId) {
            console.log(`⚠️ New running job ${newJob.id} unexpectedly has SKU ${finalNewJob.skuId} - this should be null until closed`);
        }
        
        // Closed job must have SKU assigned
        if (!finalClosedJob.skuId) {
            throw new Error(`Closed job ${currentJob.id} (${currentJob.jobName}) has no SKU assigned. This may indicate missing recipe tag data or SKU mapping.`);
        }
        
        console.log(`✅ Closed job has SKU assigned: ${finalClosedJob.skuId}, New running job remains without SKU until closed later`);

        // Store job ID for recalculation outside transaction (only for closed job)
        oldJobIdForRecalculation = currentJob.id;

        await transaction.commit();
        
        // Trigger recalculation only for the closed job outside transaction
        try {
            if (oldJobIdForRecalculation) {
                await handleRecalculation(oldJobIdForRecalculation);
                console.log("✅ Successfully processed recalculation for closed job:", oldJobIdForRecalculation);
            }
        } catch (recalcError) {
            console.error("❌ Failed to process recalculation for closed job:", recalcError);
            // Don't fail the request if recalculation fails
        }

        console.log(`🎉 Successfully created new production run from running program`);

        res.status(200).json({ 
            message: "New production run created successfully",
            data: {
                closedProgram: {
                    id: currentProgram.id,
                    name: currentProgram.programName,
                    endDate: currentTime
                },
                closedJob: {
                    id: currentJob.id,
                    name: currentJob.jobName,
                    actualEndTime: currentTime,
                    skuId: finalClosedJob.skuId
                },
                newProgram: {
                    id: newProgram.id,
                    name: newProgramName,
                    startDate: currentTime
                },
                newJob: {
                    id: newJob.id,
                    name: newJobName,
                    actualStartTime: currentTime,
                    skuId: null // Will be assigned when job is closed later
                }
            }
        });

    } catch (error) {
        console.error("Error creating new production run from running:", error);
        await transaction.rollback();
        res.status(500).json({ 
            message: "Error creating new production run", 
            error: error.message 
        });
    }
};

// Delete production run with proper cleanup
exports.deleteProductionRun = async (req, res) => {
    const transaction = await sequelize.transaction();
    const logger = req.logger || correlationLogger.child();
    
    try {
        const { id } = req.params;
        
        logger.businessEvent('delete_production_run_started', {
            programId: id,
            userId: req.userId,
            sessionId: req.sessionId
        });
        
        // Step 1: Find the program and its associated job
        const program = await Program.findByPk(id, {
            include: { model: Job, as: "jobs" },
            transaction,
        });

        if (!program) {
            await transaction.rollback();
            logger.error('Program not found for deletion', { programId: id });
            return res.status(404).json({ message: "Program not found" });
        }

        const job = program.jobs[0];
        if (!job) {
            await transaction.rollback();
            logger.error('No job found for program', { programId: id });
            return res.status(404).json({ message: "No job found for this program" });
        }

        // Step 2: Safety check - prevent deletion of running productions
        const isRunning = !program.endDate && program.startDate;
        if (isRunning) {
            await transaction.rollback();
            logger.warn('Attempted to delete running production', { 
                programId: id, 
                programName: program.programName,
                startDate: program.startDate 
            });
            return res.status(400).json({ 
                message: "Cannot delete a running production. Please end the production first." 
            });
        }

        logger.info('Starting production run deletion', {
            programId: id,
            programName: program.programName,
            jobId: job.id,
            jobName: job.jobName
        });

        // Step 3: Cleanup phase - delete all related data
        const jobId = job.id;
        
        // Delete job-specific aggregated data
        const deletedAlarms = await AlarmAggregation.destroy({ 
            where: { jobId }, 
            transaction 
        });
        
        const deletedMachineStates = await MachineStateAggregation.destroy({ 
            where: { jobId }, 
            transaction 
        });
        
        const deletedOEETimeSeries = await OEETimeSeries.destroy({ 
            where: { jobId }, 
            transaction 
        });

        logger.info('Deleted job aggregates', {
            jobId,
            deletedAlarms,
            deletedMachineStates,
            deletedOEETimeSeries
        });

        // Delete the job record
        await Job.destroy({ 
            where: { id: jobId }, 
            transaction 
        });

        // Delete the program record
        await Program.destroy({ 
            where: { id }, 
            transaction 
        });

        await transaction.commit();
        
        logger.businessEvent('delete_production_run_completed', {
            programId: id,
            programName: program.programName,
            jobId: jobId,
            jobName: job.jobName,
            deletedAlarms,
            deletedMachineStates,
            deletedOEETimeSeries
        });

        res.status(200).json({ 
            message: "Production run deleted successfully",
            deletedData: {
                programId: id,
                programName: program.programName,
                jobId: jobId,
                jobName: job.jobName,
                deletedAlarms,
                deletedMachineStates,
                deletedOEETimeSeries
            }
        });

    } catch (error) {
        logger.errorWithContext(error, {
            operation: 'delete_production_run',
            programId: req.params.id
        });
        
        try {
            await transaction.rollback();
            logger.info('Transaction rolled back successfully', {
                operation: 'delete_production_run',
                error: error.message
            });
        } catch (rollbackError) {
            logger.error('Error during transaction rollback', {
                operation: 'delete_production_run',
                originalError: error.message,
                rollbackError: rollbackError.message,
                stack: rollbackError.stack
            });
        }
        
        res.status(500).json({ 
            message: "Error deleting production run", 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Export the assignSkuToJob function for use in other controllers
module.exports.assignSkuToJob = assignSkuToJob;
