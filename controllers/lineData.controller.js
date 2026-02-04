const db = require("../dbInit");
const { LineData, Op, Job } = db;
const { calculateTrueEfficiency } = require('./Kpis.controller');
const { calculateAggregatedTrueEfficiency } = require('../utils/trueEfficiencyAggregator');
const dayjs = require('dayjs');

exports.createLineData = async (req, res) => {
  try {
    const { name, description, lineData, userId } = req.body;

    // Validate required fields
    if (!lineData) {
      return res.status(400).send({ message: "lineData is required" });
    }

    // Check if line data with the same name already exists for this user (if userId provided)
    if (name && userId) {
      const existingLineData = await LineData.findOne({
        where: {
          name,
          userId,
        },
      });
      if (existingLineData) {
        return res.status(400).send({ message: "Line data with this name already exists" });
      }
    }

    const data = await LineData.create({
      name: name || "Line Data",
      description: description || null,
      lineData,
      userId: userId || null,
      isActive: true,
    });

    res.status(201).send(data);
  } catch (error) {
    console.error("Error creating line data:", error);
    res.status(500).send({
      message: "Error creating line data",
      error: error.message,
    });
  }
};

exports.getAllLineData = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const lineData = await LineData.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).send(lineData);
  } catch (error) {
    console.error("Error fetching line data:", error);
    res.status(500).send({
      message: "Error fetching line data",
      error: error.message,
    });
  }
};

exports.getLineDataById = async (req, res) => {
  try {
    const data = await LineData.findByPk(req.params.id);
    if (data) {
      res.status(200).send(data);
    } else {
      res.status(404).send({ message: "Line data not found." });
    }
  } catch (error) {
    console.error("Error fetching line data:", error);
    res.status(500).send({
      message: "Error fetching line data",
      error: error.message,
    });
  }
};

exports.getActiveLineData = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = { isActive: true };
    if (userId) {
      whereClause.userId = userId;
    }

    const data = await LineData.findOne({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    if (data) {
      res.status(200).send(data);
    } else {
      res.status(404).send({ message: "No active line data found." });
    }
  } catch (error) {
    console.error("Error fetching active line data:", error);
    res.status(500).send({
      message: "Error fetching active line data",
      error: error.message,
    });
  }
};

exports.updateLineData = async (req, res) => {
  try {
    const dataId = req.params.id;
    const { name, description, lineData, isActive } = req.body;

    const data = await LineData.findByPk(dataId);
    if (!data) {
      return res.status(404).send({ message: "Line data not found." });
    }

    // Update fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (lineData !== undefined) updateData.lineData = lineData;
    if (isActive !== undefined) updateData.isActive = isActive;

    await data.update(updateData);

    res.status(200).send({
      message: "Line data updated successfully.",
      lineData: data,
    });
  } catch (error) {
    console.error("Error updating line data:", error);
    res.status(500).send({
      message: "Error updating line data",
      error: error.message,
    });
  }
};

exports.deleteLineData = async (req, res) => {
  try {
    const deleted = await LineData.destroy({
      where: { id: req.params.id },
    });

    if (deleted === 1) {
      res.status(200).send({ message: "Line data deleted successfully." });
    } else {
      res.status(404).send({ message: "Line data not found." });
    }
  } catch (error) {
    console.error("Error deleting line data:", error);
    res.status(500).send({
      message: "Error deleting line data",
      error: error.message,
    });
  }
};

exports.getAllLineDataPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const { count, rows } = await LineData.findAndCountAll({
      where: whereClause,
      limit,
      offset: page * limit,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).send({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.error("Pagination Error:", error);
    res.status(500).send({
      message: "Error fetching paginated line data",
      error: error.message,
    });
  }
};

/**
 * ========================================
 * GET TRUE EFFICIENCY FOR PLANNING MODULE
 * ========================================
 * 
 * Calculates aggregated True Efficiency for a recipe-line combination in a specific year.
 * 
 * Reuses the EXACT same logic as date range reports:
 * - Formula: (Σ VOT / Σ Program Duration) × 100
 * - Weighted by program duration (longer programs have more impact)
 * 
 * GET /api/line-data/true-efficiency?recipeId=1&lineId=2&year=2025
 * 
 * Query Parameters:
 * - recipeId: Recipe ID (required)
 * - lineId: Line ID (required)
 * - year: Year to analyze (e.g., 2025) (required)
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     recipeId: 1,
 *     lineId: 2,
 *     year: 2025,
 *     trueEfficiency: 54.32,
 *     jobCount: 15,
 *     totalVOT: 12345.67,
 *     totalProgramDuration: 22723.00,
 *     message: "Calculated from 15 production runs in 2025"
 *   }
 * }
 */
exports.getTrueEfficiencyForPlanning = async (req, res) => {
  try {
    const { recipeId, lineId, year } = req.query;
    
    // Validation
    if (!recipeId || !lineId || !year) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: recipeId, lineId, and year are required',
        example: '/api/line-data/true-efficiency?recipeId=1&lineId=2&year=2025'
      });
    }

    const parsedRecipeId = parseInt(recipeId);
    const parsedLineId = parseInt(lineId);
    const parsedYear = parseInt(year);

    // Validate parsed values
    if (isNaN(parsedRecipeId) || isNaN(parsedLineId) || isNaN(parsedYear)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid parameter format: recipeId, lineId, and year must be valid integers'
      });
    }

    console.log(`[TRUE EFFICIENCY] Calculating for recipe ${parsedRecipeId}, line ${parsedLineId}, year ${parsedYear}`);

    // Get all completed jobs for this recipe-line combination in the specified year
    const jobs = await Job.findAll({
      where: {
        recipeId: parsedRecipeId,
        lineId: parsedLineId,
        actualEndTime: { [Op.not]: null }, // Only completed jobs
        actualStartTime: {
          [Op.between]: [
            dayjs(`${parsedYear}-01-01`).startOf('year').toDate(),
            dayjs(`${parsedYear}-12-31`).endOf('year').toDate()
          ]
        }
      },
      order: [['actualStartTime', 'DESC']],
      attributes: ['id', 'programId', 'lineId', 'recipeId', 'actualStartTime', 'actualEndTime', 'jobName']
    });

    console.log(`[TRUE EFFICIENCY] Found ${jobs.length} completed jobs`);

    if (jobs.length === 0) {
      // No historical data - return 0 with informative message
      console.log(`[TRUE EFFICIENCY] No historical data found`);
      return res.status(200).json({
        success: true,
        data: {
          recipeId: parsedRecipeId,
          lineId: parsedLineId,
          year: parsedYear,
          trueEfficiency: 0,
          jobCount: 0,
          totalVOT: 0,
          totalProgramDuration: 0,
          message: `No historical production data available for this recipe-line combination in ${parsedYear}`
        }
      });
    }

    // Calculate aggregated true efficiency using shared utility
    // This uses the EXACT same logic as date range reports (report.controller.js)
    console.log(`[TRUE EFFICIENCY] Calculating aggregated efficiency...`);
    const result = await calculateAggregatedTrueEfficiency(jobs, calculateTrueEfficiency);

    console.log(`[TRUE EFFICIENCY] Result: ${result.trueEfficiency}% (${result.jobCount} successful, ${result.failedJobs} failed)`);

    res.status(200).json({
      success: true,
      data: {
        recipeId: parsedRecipeId,
        lineId: parsedLineId,
        year: parsedYear,
        trueEfficiency: result.trueEfficiency,
        jobCount: result.jobCount,
        totalVOT: result.totalVOT,
        totalProgramDuration: result.totalProgramDuration,
        failedJobs: result.failedJobs,
        message: result.jobCount > 0 
          ? `Calculated from ${result.jobCount} production run${result.jobCount > 1 ? 's' : ''} in ${parsedYear}${result.failedJobs > 0 ? ` (${result.failedJobs} job${result.failedJobs > 1 ? 's' : ''} excluded due to calculation errors)` : ''}`
          : `No valid production data available for ${parsedYear}`
      }
    });
  } catch (error) {
    console.error('[TRUE EFFICIENCY] Error calculating true efficiency for planning:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate true efficiency',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

