const dayjs = require("dayjs");
const db = require("../dbInit");
const TagRefs = require("../utils/constants/TagRefs");
const { Job, Tags, TagValues, Program, sequelize, Op } = db;
// const { insertTagValuesWithoutDuplicates, zeroOutTagValues, ONE_MINUTE } = require("../utils/tagValueUtils");

exports.createJob = async (req, res) => {
    try {
        const { jobName } = req.body;

        // Check if a job with the same name already exists
        const existingJob = await Job.findOne({ where: { jobName } });

        if (existingJob) {
            return res.status(400).json({ message: "exists" });
        }

        // Create new job if no duplicate exists
        const job = await Job.create(req.body);
        res.status(201).send(job);
    } catch (error) {
        res.status(400).send(error);
    }
};

exports.getAllJobs = async (req, res) => {
    try {
        const jobs = await Job.findAll();
        res.status(200).send(jobs);
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getJobById = async (req, res) => {
    try {
        const job = await Job.findByPk(req.params.id);
        if (job) {
            res.status(200).send(job);
        } else {
            res.status(404).send({ message: "Job not found." });
        }
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.updateJob = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const jobId = req.params.id;

        // Fetch the existing job
        const job = await Job.findByPk(jobId, { transaction });
        if (!job) {
            await transaction.rollback();
            return res.status(404).send({ message: "Job not found." });
        }
        const oldActualEnd = new Date(job.actualEndTime);
        const newActualEnd = new Date(req.body.actualEndTime);

        // Validate the program associated with the job
        const { isValid, message } = await validateProgramByJob(job, transaction);

        if (!isValid) {
            await transaction.rollback();
            return res.status(400).send({ message });
        }

        const existingJob = await Job.findOne({
            where: {
                id: { [Op.ne]: jobId },
                jobName: req.body.jobName,
            },
            transaction,
        });

        if (existingJob) {
            await transaction.rollback();
            return res.status(400).send({ message: "exists" });
        }

        const [updated] = await Job.update(req.body, {
            where: { id: jobId },
            transaction,
        });

        if (updated) {
            if (newActualEnd < oldActualEnd) {
                //if new date less then the jobitself date
                const bacTag = await Tags.findOne({
                    where: {
                        ref: TagRefs.BATCH_ACTIVE,
                        taggableId: job.lineId,
                    },
                    transaction,
                });

                if (bacTag) {
                    const fromTime = newActualEnd.getTime() + ONE_MINUTE;
                    const toTime = oldActualEnd;
                    await zeroOutTagValues({
                        tagId: bacTag.id,
                        fromDate: fromTime,
                        toDate: toTime,
                        transaction,
                    });
                }
            }


            // Only proceed if extended
            if (newActualEnd > oldActualEnd) {
                const overlaps = await Job.findAll({
                    where: {
                        id: { [Op.ne]: job.id },
                        lineId: job.lineId,
                        actualStartTime: { [Op.lte]: newActualEnd },
                        actualEndTime: { [Op.gte]: oldActualEnd },
                    },
                    transaction,
                });

                if (overlaps.length > 0) {
                    await transaction.rollback();
                    return res.status(200).json({
                        mergeRequired: true,
                        conflicts: overlaps.map((j) => ({
                            id: j.id,
                            jobName: j.jobName,
                            actualStartTime: j.actualStartTime,
                            actualEndTime: j.actualEndTime,
                        })),
                    });
                }
            }

            // No conflict -> safe to continue
            await extendJobIfNeeded(job, newActualEnd, transaction);
            await transaction.commit();
            res.status(200).send({ message: "Job updated successfully." });
        } else {
            await transaction.rollback();
            res.status(404).send({ message: "Job not found." });
        }
    } catch (error) {
        await transaction.rollback();
        console.log(error);
        res.status(500).send(error);
    }
};

exports.deleteJob = async (req, res) => {
    try {
        const job = await Job.destroy({
            where: { id: req.params.id },
        });
        if (job == 1) {
            res.status(200).send({ message: "Job deleted successfully." });
        } else {
            res.status(404).send({ message: "Job not found." });
        }
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getJobByRefId = async (req, res) => {
    try {
        const job = await Job.findOne({ where: { jobRefId: req.params.jobRefId } });
        if (job) {
            res.status(200).send(job);
        } else {
            res.status(404).send({ message: "Job not found." });
        }
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getJobByName = async (req, res) => {
    try {
        const job = await Job.findAll({ where: { jobName: req.params.name } });
        res.status(200).send(job);
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getJobBySku = async (req, res) => {
    try {
        const job = await Job.findAll({ where: { SKU: req.params.sku } });
        res.status(200).send(job);
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.getAllJobsPaginated = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 0;
        
        // Build where clause - for JobRecalculation page, only show completed jobs
        const whereClause = {};
        
        // If onlyCompleted parameter is true, filter out running jobs (without actualEndTime)
        if (req.query.onlyCompleted === 'true') {
            whereClause.actualEndTime = { [Op.not]: null };
            whereClause.actualStartTime = { [Op.not]: null };
        }
        
        const { count, rows } = await Job.findAndCountAll({
            where: whereClause,
            limit,
            offset: page * limit,
            order: [["createdAt", "DESC"]],
            include: [
                { model: db.Sku, as: "sku" },
                { model: db.Line, as: "line" },
            ],
        });
        res.status(200).send({
            total: count,
            pages: Math.ceil(count / limit),
            data: rows,
        });
    } catch (error) {
        res.status(500).send(error);
    }
};

exports.bulkInsertJobs = async (req, res) => {
    try {
        const jobs = req.body;

        if (!jobs || jobs.length === 0) {
            return res.status(400).json({ message: "No data to insert." });
        }

        // Get current timestamp for createdAt and updatedAt
        const currentTime = dayjs().format("YYYY-MM-DD HH:mm:ss");

        const incomingJobNames = jobs.map((job) => job.jobName); // Ensure it's an array
        console.log("Incoming Job Names:", incomingJobNames); // Debugging output

        const existingJobsQuery = `SELECT jobName FROM jobs WHERE jobName IN (:jobNames)`;
        const existingJobs = await sequelize.query(existingJobsQuery, {
            replacements: { jobNames: incomingJobNames },
            type: sequelize.QueryTypes.SELECT,
        });

        // Ensure existingJobs is an array
        const existingJobNames = Array.isArray(existingJobs)
            ? existingJobs.map((job) => job.jobName)
            : [];

        // Filter out jobs that already exist
        const newJobs = jobs.filter(
            (job) => !existingJobNames.includes(job.jobName)
        );

        if (newJobs.length > 0) {
            const values = newJobs
                .map(
                    (job) => `(
        '${job.jobName || null}', 
        '${dayjs(job.plannedStartTime).format("YYYY-MM-DD HH:mm:ss")}', 
        '${dayjs(job.plannedEndTime).format("YYYY-MM-DD HH:mm:ss")}', 
        '${job.jobDescription || null}', 
        '${job.skuId || null}', 
        '${job.plannedProduction || null}', 
        '${job.lineId || null}',
        '${currentTime}',  -- createdAt
        '${currentTime}'   -- updatedAt
      )`
                )
                .join(", ");

            const insertQuery = `
      INSERT INTO Jobs 
      (jobName, plannedStartTime, plannedEndTime, jobDescription, skuId, plannedProduction, lineId, createdAt, updatedAt) 
      VALUES ${values};
    `;

            // Execute the raw insert query
            await sequelize.query(insertQuery);
        }

        return res.status(201).json({
            message: "Jobs insert bulk successfully!",
            inserted: newJobs.map((j) => j.jobName), // Newly inserted job names
            existing: existingJobNames, // Already existing job names
        });
    } catch (error) {
        console.error("Error inserting jobs:", error);
        return res.status(500).json({
            message: "Failed to insert jobs",
            error: error.message,
        });
    }
};

exports.getJobsByLineAndDate = async (req, res) => {
    const { lineId } = req.params;
    const { startDate, endDate, includeRunning } = req.query;

    if (!startDate || !endDate) {
        return res
            .status(400)
            .json({ message: "Start date and end date are required." });
    }

    try {
        // Build where clause for Program
        const whereClause = {
            lineId,
            startDate: { [Op.gte]: startDate },
        };

        // Build where clause for Job include
        const jobWhereClause = {};

        // If includeRunning is true, include both completed and running jobs
        // Otherwise, only include completed jobs
        if (includeRunning === 'true' || includeRunning === true) {
            // Include programs where:
            // 1. Program endDate is NULL (running program) OR Program endDate <= endDate (completed program)
            // 2. AND there exists at least one job with actualEndTime IS NULL (running job) OR actualEndTime <= endDate
            whereClause[Op.or] = [
                { endDate: { [Op.lte]: endDate } },
                { endDate: null }
            ];
            // Include jobs that are running (actualEndTime IS NULL) or completed within date range
            jobWhereClause[Op.or] = [
                { actualEndTime: { [Op.lte]: endDate } },
                { actualEndTime: null }
            ];
        } else {
            // Default behavior: only completed jobs
            // Program must have endDate <= endDate
            whereClause.endDate = { [Op.lte]: endDate };
            // Job must have actualEndTime <= endDate (completed job)
            jobWhereClause.actualEndTime = { [Op.lte]: endDate };
        }

        const programs = await db.Program.findAll({
            where: whereClause,
            include: [{
                model: Job,
                as: 'jobs',
                required: true,  // INNER JOIN - excludes orphaned programs (programs without jobs)
                where: jobWhereClause,  // Filter jobs based on actualEndTime
                attributes: []   // Don't fetch job data, just check existence
            }],
            order: [["startDate", "ASC"]],
        });

        res.status(200).json({ programs });
    } catch (error) {
        console.error("Error fetching programs by line and date:", error);
        res.status(500).json({
            message: "An error occurred while fetching programs.",
            error,
        });
    }
};


exports.getJobsByLocationAndDate = async (req, res) => {
    const { locationId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res
            .status(400)
            .json({ message: "Start and end dates are required." });
    }

    try {
        // Get all lines under the selected location
        const lines = await db.Line.findAll({ where: { locationId } });
        const lineIds = lines.map((line) => line.id);

        if (!lineIds.length) {
            return res
                .status(404)
                .json({ message: "No lines found for the location." });
        }

        // Get jobs for those lines
        const jobs = await db.Job.findAll({
            where: {
                lineId: { [Op.in]: lineIds },
                actualStartTime: { [Op.gte]: startDate },
                actualEndTime: { [Op.lte]: endDate },
            },
            order: [["actualStartTime", "ASC"]],
        });

        res.status(200).json({ jobs });
    } catch (error) {
        console.error("Error fetching jobs by location:", error);
        res.status(500).json({ message: "Error fetching jobs", error });
    }
};

exports.getJobsByLocation = async (req, res) => {
    const { locationId } = req.params;
    const { startDate, endDate } = req.query;

    if (!locationId || !startDate || !endDate) {
        return res
            .status(400)
            .json({ message: "Missing locationId or date range" });
    }

    try {
        // Get all lines under the location
        const lines = await db.Line.findAll({
            where: { locationId },
            attributes: ["id"],
        });

        const lineIds = lines.map((l) => l.id);

        if (!lineIds.length) {
            return res.status(200).json({ jobs: [] });
        }

        const jobs = await db.Job.findAll({
            where: {
                lineId: { [Op.in]: lineIds },
                actualStartTime: { [Op.gte]: startDate },
                actualEndTime: { [Op.lte]: endDate },
            },
            order: [["actualStartTime", "ASC"]],
        });

        res.status(200).json({ jobs });
    } catch (err) {
        console.error("getJobsByLocation error:", err);
        res.status(500).json({ message: "Server error fetching jobs." });
    }
};

exports.getJobsByMultipleLines = async (req, res) => {
    const { lineIds, startDate, endDate } = req.body;

    if (!Array.isArray(lineIds) || lineIds.length === 0) {
        return res.status(400).json({ message: "Line IDs are required." });
    }
    if (!startDate || !endDate) {
        return res
            .status(400)
            .json({ message: "Start and end dates are required." });
    }

    try {
        const jobs = await db.Job.findAll({
            where: {
                lineId: { [Op.in]: lineIds },
                actualStartTime: { [Op.gte]: startDate },
                actualEndTime: { [Op.lte]: endDate },
            },
            order: [["actualStartTime", "ASC"]],
        });

        res.status(200).json({ jobs });
    } catch (error) {
        console.error("Error fetching jobs by multiple lines:", error);
        res.status(500).json({ message: "Server error fetching jobs.", error });
    }
};

exports.confirmMerge = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const jobId = req.params.id;
        const job = await Job.findByPk(jobId, { transaction });

        if (!job) {
            await transaction.rollback();
            return res.status(404).json({ message: "Job not found." });
        }

        const updated = await Job.update(req.body, {
            where: { id: jobId },
            transaction,
        });

        if (!updated) {
            await transaction.rollback();
            return res.status(400).json({ message: "Job update failed." });
        }

        const actualEndTime = new Date(req.body.actualEndTime);

        if (!req.body.actualEndTime || isNaN(actualEndTime)) {
            await transaction.rollback();
            return res
                .status(400)
                .json({ message: "Invalid actualEndTime provided." });
        }

        await extendJobIfNeeded(job, actualEndTime, transaction);

        await transaction.commit();
        res.status(200).json({ message: "Merge completed and job updated." });
    } catch (error) {
        await transaction.rollback();
        console.error("Error in confirmMerge:", error);
        res.status(500).json({ message: "Server error during confirm merge." });
    }
};

exports.getProgramsByMultipleLines = async (req, res) => {
    const { lineIds, startDate, endDate } = req.body;

    if (!Array.isArray(lineIds) || lineIds.length === 0) {
        return res.status(400).json({ message: "Line IDs are required." });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ message: "Start and end dates are required." });
    }

    try {
        const programs = await Program.findAll({
            where: {
                lineId: { [Op.in]: lineIds },
                startDate: { [Op.gte]: startDate },
                endDate: { [Op.lte]: endDate },
            },
            include: [{
                model: Job,
                as: 'jobs',
                required: true,  // INNER JOIN - excludes orphaned programs (programs without jobs)
                attributes: []   // Don't fetch job data, just check existence
            }],
            order: [["startDate", "ASC"]],
        });

        res.status(200).json({ programs });
    } catch (err) {
        console.error("Program fetch failed:", err);
        res.status(500).json({ message: "Failed to fetch programs." });
    }
};

exports.getProgramsByLocation = async (req, res) => {
    const { locationId, startDate, endDate } = req.query;

    if (!locationId || !startDate || !endDate) {
        return res.status(400).json({ message: "Missing locationId or date range." });
    }

    try {
        // Get all lines under the selected location
        const lines = await db.Line.findAll({
            where: { locationId },
            attributes: ["id"],
        });

        const lineIds = lines.map((line) => line.id);

        if (!lineIds.length) {
            return res.status(200).json({ programs: [] });
        }

        // Fetch programs for all lines in that location
        const programs = await db.Program.findAll({
            where: {
                lineId: { [db.Sequelize.Op.in]: lineIds },
                startDate: { [db.Sequelize.Op.gte]: startDate },
                endDate: { [db.Sequelize.Op.lte]: endDate },
            },
            include: [{
                model: Job,
                as: 'jobs',
                required: true,  // INNER JOIN - excludes orphaned programs (programs without jobs)
                attributes: []   // Don't fetch job data, just check existence
            }],
            order: [["startDate", "ASC"]],
        });

        res.status(200).json({ programs });
    } catch (error) {
        console.error("Error fetching programs by location:", error);
        res.status(500).json({ message: "Failed to fetch programs by location." });
    }
};

async function extendJobIfNeeded(job, newActualEndTime, transaction) {
    const oldActualEnd = new Date(job.actualEndTime);
    const newEnd = new Date(newActualEndTime);

    if (newEnd <= oldActualEnd) return; // No extension needed

    // 1. Detect overlapping jobs on the same line
    const overlappingJobs = await Job.findAll({
        where: {
            id: { [Op.ne]: job.id },
            lineId: job.lineId,
            actualStartTime: { [Op.lte]: newEnd },
            actualEndTime: { [Op.gte]: oldActualEnd },
        },
        transaction,
    });

    if (overlappingJobs.length > 0) {
        // 2. Merge logic
        const mergeStart = new Date(
            Math.min(
                job.actualStartTime.getTime(),
                ...overlappingJobs.map((j) => new Date(j.actualStartTime).getTime())
            )
        );
        const mergeEnd = new Date(
            Math.max(
                newEnd.getTime(),
                ...overlappingJobs.map((j) => new Date(j.actualEndTime).getTime())
            )
        );

        await Job.update(
            {
                actualStartTime: mergeStart,
                actualEndTime: mergeEnd,
            },
            {
                where: { id: job.id },
                transaction,
            }
        );

        const overlapIds = overlappingJobs.map((j) => j.id);

        await Job.destroy({
            where: { id: { [Op.in]: overlapIds } },
            transaction,
        });

    } else {
        // 3. No overlap: extend and insert new TagValues
        await Job.update(
            {
                actualEndTime: newEnd,
            },
            {
                where: { id: job.id },
                transaction,
            }
        );

        const bacTag = await Tags.findOne({
            where: {
                ref: TagRefs.BATCH_ACTIVE,
                taggableId: job.lineId,
            },
            transaction,
        });

        if (bacTag) {
            // await insertTagValuesWithoutDuplicates({
            //     tagId: bacTag.id,
            //     fromDate: oldActualEnd.getTime() + ONE_MINUTE,
            //     toDate: newEnd,
            //     transaction,
            // });
        }
    }
}

async function validateProgramByJob(job, transaction) {
    const program = await Program.findOne({
        where: {
            Id: job.programId,
        },
        transaction,
    });

    if (!program) {
        return {
            isValid: false,
            message: "Job's actual time must fall within a valid program timeframe for this line.",
        };
    }

    return { isValid: true, program };
}

// Find job by program ID
exports.getJobByProgramId = async (req, res) => {
    try {
        const { id } = req.params; // program ID
        
        // Import the job service
        const { jobService } = require("../utils/modules");
        
        // Find the job for this program ID
        const job = await jobService.findJobByProgramId(id, {
            attributes: ["id", "actualStartTime", "actualEndTime", "jobName"],
            raw: false,
        });
        
        if (!job) {
            return res.status(404).json({ 
                message: "No job found for this program" 
            });
        }
        
        res.status(200).json({
            id: job.id,
            jobName: job.jobName,
            actualStartTime: job.actualStartTime,
            actualEndTime: job.actualEndTime,
            programId: id
        });
    } catch (error) {
        console.error("Error finding job by program ID:", error);
        res.status(500).json({ 
            message: "Failed to find job", 
            error: error.message 
        });
    }
};

// Check OEE data availability for a job
exports.getOeeDataStatus = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Import the OEE time series service
        const { oeeTimeSeriesService } = require("../utils/modules");
        
        // Get the count of OEE time series data for this job
        const oeeData = await oeeTimeSeriesService.getCurve(id);
        const dataLength = oeeData ? oeeData.length : 0;
        
        res.status(200).json({
            jobId: id,
            dataLength: dataLength,
            available: dataLength > 0,
            message: dataLength > 0 ? "OEE data available" : "OEE data not yet calculated"
        });
    } catch (error) {
        console.error("Error checking OEE data status:", error);
        res.status(500).json({ 
            message: "Failed to check OEE data status", 
            error: error.message 
        });
    }
};

// ============================================================================
// MANUAL RECALCULATION ENDPOINTS - For Developer/Admin Use
// ============================================================================

/**
 * Trigger manual recalculation of aggregates for a single job
 * @route POST /api/jobs/:id/recalculate
 * @access Admin only
 * @description Manually triggers recalculation of all aggregates (alarms, machine states, OEE)
 *              for a specific job. Useful for data corrections or maintenance.
 */
exports.triggerRecalculation = async (req, res) => {
    const jobId = req.params.id;
    
    try {
        // Input validation
        if (!jobId || isNaN(parseInt(jobId))) {
            return res.status(400).json({
                success: false,
                message: "Invalid job ID provided"
            });
        }

        // Verify job exists
        const job = await Job.findByPk(jobId, {
            attributes: ['id', 'jobName', 'actualStartTime', 'actualEndTime'],
            include: [
                { model: db.Line, as: "line", attributes: ['id', 'name'] },
                { model: db.Sku, as: "sku", attributes: ['id', 'name'] }
            ]
        });

        if (!job) {
            return res.status(404).json({
                success: false,
                message: `Job with ID ${jobId} not found`
            });
        }

        // Verify job has actual times (completed job)
        if (!job.actualStartTime || !job.actualEndTime) {
            return res.status(400).json({
                success: false,
                message: "Job must have actual start and end times to recalculate aggregates",
                jobId: parseInt(jobId)
            });
        }

        // Trigger recalculation using the environment-aware handler
        const result = await handleRecalculation(parseInt(jobId));

        // Return success response
        return res.status(200).json({
            success: true,
            message: `Recalculation queued successfully for job "${job.jobName}"`,
            jobId: parseInt(jobId),
            jobName: job.jobName,
            line: job.line?.name,
            sku: job.sku?.name,
            queueResult: result
        });

    } catch (error) {
        console.error(`Error triggering recalculation for job ${jobId}:`, error);
        return res.status(500).json({
            success: false,
            message: "Failed to trigger recalculation",
            error: error.message,
            jobId: parseInt(jobId)
        });
    }
};

/**
 * Trigger manual recalculation for multiple jobs (bulk operation)
 * @route POST /api/jobs/bulk-recalculate
 * @access Admin only
 * @description Triggers recalculation for multiple jobs in parallel
 */
exports.triggerBulkRecalculation = async (req, res) => {
    const { jobIds } = req.body;

    try {
        // Input validation
        if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "jobIds must be a non-empty array"
            });
        }

        // Validate all IDs are numbers
        const validJobIds = jobIds.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
        
        if (validJobIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid job IDs provided"
            });
        }

        // Limit bulk operations to prevent system overload
        const MAX_BULK_SIZE = 50;
        if (validJobIds.length > MAX_BULK_SIZE) {
            return res.status(400).json({
                success: false,
                message: `Bulk recalculation limited to ${MAX_BULK_SIZE} jobs at once. Please select fewer jobs.`,
                limit: MAX_BULK_SIZE,
                requested: validJobIds.length
            });
        }

        // Fetch all jobs to verify they exist and have required data
        const jobs = await Job.findAll({
            where: { id: { [Op.in]: validJobIds } },
            attributes: ['id', 'jobName', 'actualStartTime', 'actualEndTime'],
            include: [
                { model: db.Line, as: "line", attributes: ['id', 'name'] },
                { model: db.Sku, as: "sku", attributes: ['id', 'name'] }
            ]
        });

        if (jobs.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No valid jobs found with provided IDs"
            });
        }

        // Separate valid and invalid jobs
        const validJobs = [];
        const invalidJobs = [];

        jobs.forEach(job => {
            if (job.actualStartTime && job.actualEndTime) {
                validJobs.push(job);
            } else {
                invalidJobs.push({
                    id: job.id,
                    jobName: job.jobName,
                    reason: "Missing actual start or end time"
                });
            }
        });

        // Find jobs that weren't in database
        const foundJobIds = jobs.map(j => j.id);
        const notFoundJobIds = validJobIds.filter(id => !foundJobIds.includes(id));
        
        notFoundJobIds.forEach(id => {
            invalidJobs.push({
                id,
                jobName: "Unknown",
                reason: "Job not found"
            });
        });

        // Queue recalculation for all valid jobs
        const results = await Promise.allSettled(
            validJobs.map(async (job) => {
                try {
                    const result = await handleRecalculation(job.id);
                    return {
                        success: true,
                        jobId: job.id,
                        jobName: job.jobName,
                        line: job.line?.name,
                        sku: job.sku?.name,
                        result
                    };
                } catch (error) {
                    return {
                        success: false,
                        jobId: job.id,
                        jobName: job.jobName,
                        error: error.message
                    };
                }
            })
        );

        // Process results
        const successful = results
            .filter(r => r.status === 'fulfilled' && r.value.success)
            .map(r => r.value);

        const failed = results
            .filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
            .map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message });

        // Prepare response
        const response = {
            success: successful.length > 0,
            message: `Queued ${successful.length} of ${validJobIds.length} jobs for recalculation`,
            summary: {
                total: validJobIds.length,
                queued: successful.length,
                failed: failed.length,
                invalid: invalidJobs.length
            },
            results: {
                successful,
                failed: [...failed, ...invalidJobs]
            }
        };

        // Return appropriate status code
        const statusCode = successful.length > 0 ? 200 : 400;
        return res.status(statusCode).json(response);

    } catch (error) {
        console.error("Error in bulk recalculation:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to process bulk recalculation",
            error: error.message
        });
    }
};

/**
 * Helper function to handle recalculation based on environment
 * Uses Bull queue for local/Azure environments
 * @private
 */
async function handleRecalculation(jobId) {
    try {
        const getRecalculationQueue = () => {
            const recalculationQueue = require("../utils/queues/recalculationQueue");
            return recalculationQueue;
        };

        console.log(`🔄 Adding job ${jobId} to recalculation queue`);
        const queue = getRecalculationQueue();
        const job = await queue.add({ jobId });
        
        console.log(`✅ Job ${jobId} added to queue with Bull job ID: ${job.id}`);
        
        return {
            queued: true,
            bullJobId: job.id,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error(`❌ Error adding job ${jobId} to queue:`, error);
        throw new Error(`Failed to queue job: ${error.message}`);
    }
}