const db = require("../dbInit");
const { PackageSummary, Op } = db;

/**
 * Create a new Package Summary
 */
exports.createPackageSummary = async (req, res) => {
  try {
    const { name, description, summaryData, userId, isActive } = req.body;

    // Deactivate all other package summaries if this one is active
    if (isActive) {
      await PackageSummary.update(
        { isActive: false },
        { where: { isActive: true } }
      );
    }

    const packageSummary = await PackageSummary.create({
      name: name || "Package Summary",
      description,
      summaryData: summaryData || { years: [], packagesByYear: {} },
      userId,
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).send({
      message: "Package Summary created successfully",
      data: packageSummary,
    });
  } catch (error) {
    console.error("Error creating Package Summary:", error);
    res.status(500).send({
      message: error.message || "Error creating Package Summary",
    });
  }
};

/**
 * Get all Package Summaries
 */
exports.getAllPackageSummaries = async (req, res) => {
  try {
    const packageSummaries = await PackageSummary.findAll({
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: db.User,
          as: "user",
          attributes: ["id", "username", "email"],
        },
      ],
    });

    res.status(200).send(packageSummaries);
  } catch (error) {
    console.error("Error fetching Package Summaries:", error);
    res.status(500).send({
      message: error.message || "Error fetching Package Summaries",
    });
  }
};

/**
 * Get all Package Summaries with pagination
 */
exports.getAllPackageSummariesPaginated = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "" } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = search
      ? {
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
          ],
        }
      : {};

    const { count, rows } = await PackageSummary.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: db.User,
          as: "user",
          attributes: ["id", "username", "email"],
        },
      ],
    });

    res.status(200).send({
      data: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching paginated Package Summaries:", error);
    res.status(500).send({
      message: error.message || "Error fetching Package Summaries",
    });
  }
};

/**
 * Get Package Summary by ID
 */
exports.getPackageSummaryById = async (req, res) => {
  try {
    const { id } = req.params;

    const packageSummary = await PackageSummary.findByPk(id, {
      include: [
        {
          model: db.User,
          as: "user",
          attributes: ["id", "username", "email"],
        },
      ],
    });

    if (!packageSummary) {
      return res.status(404).send({
        message: `Package Summary with id ${id} not found`,
      });
    }

    res.status(200).send(packageSummary);
  } catch (error) {
    console.error("Error fetching Package Summary:", error);
    res.status(500).send({
      message: error.message || "Error fetching Package Summary",
    });
  }
};

/**
 * Get active Package Summary
 */
exports.getActivePackageSummary = async (req, res) => {
  try {
    const packageSummary = await PackageSummary.findOne({
      where: { isActive: true },
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: db.User,
          as: "user",
          attributes: ["id", "username", "email"],
        },
      ],
    });

    if (!packageSummary) {
      return res.status(404).send({
        message: "No active Package Summary found",
      });
    }

    res.status(200).send(packageSummary);
  } catch (error) {
    console.error("Error fetching active Package Summary:", error);
    res.status(500).send({
      message: error.message || "Error fetching active Package Summary",
    });
  }
};

/**
 * Update Package Summary
 */
exports.updatePackageSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, summaryData, userId, isActive } = req.body;

    const packageSummary = await PackageSummary.findByPk(id);

    if (!packageSummary) {
      return res.status(404).send({
        message: `Package Summary with id ${id} not found`,
      });
    }

    // If setting this as active, deactivate all others
    if (isActive && !packageSummary.isActive) {
      await PackageSummary.update(
        { isActive: false },
        { where: { isActive: true, id: { [Op.ne]: id } } }
      );
    }

    await packageSummary.update({
      name: name !== undefined ? name : packageSummary.name,
      description: description !== undefined ? description : packageSummary.description,
      summaryData: summaryData !== undefined ? summaryData : packageSummary.summaryData,
      userId: userId !== undefined ? userId : packageSummary.userId,
      isActive: isActive !== undefined ? isActive : packageSummary.isActive,
    });

    res.status(200).send({
      message: "Package Summary updated successfully",
      data: packageSummary,
    });
  } catch (error) {
    console.error("Error updating Package Summary:", error);
    res.status(500).send({
      message: error.message || "Error updating Package Summary",
    });
  }
};

/**
 * Delete Package Summary
 */
exports.deletePackageSummary = async (req, res) => {
  try {
    const { id } = req.params;

    const packageSummary = await PackageSummary.findByPk(id);

    if (!packageSummary) {
      return res.status(404).send({
        message: `Package Summary with id ${id} not found`,
      });
    }

    await packageSummary.destroy();

    res.status(200).send({
      message: "Package Summary deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting Package Summary:", error);
    res.status(500).send({
      message: error.message || "Error deleting Package Summary",
    });
  }
};

