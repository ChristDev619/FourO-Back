const db = require("../dbInit");
const { SeasonalityData, Op } = db;

exports.createSeasonalityData = async (req, res) => {
  try {
    const { name, description, seasonalityData, userId } = req.body;

    // Validate required fields
    if (!seasonalityData) {
      return res.status(400).send({ message: "seasonalityData is required" });
    }

    // Check if seasonality data with the same name already exists for this user (if userId provided)
    if (name && userId) {
      const existingData = await SeasonalityData.findOne({
        where: {
          name,
          userId,
        },
      });
      if (existingData) {
        return res.status(400).send({ message: "Seasonality data with this name already exists" });
      }
    }

    const data = await SeasonalityData.create({
      name: name || "Seasonality Data",
      description: description || null,
      seasonalityData,
      userId: userId || null,
      isActive: true,
    });

    res.status(201).send(data);
  } catch (error) {
    console.error("Error creating seasonality data:", error);
    res.status(500).send({
      message: "Error creating seasonality data",
      error: error.message,
    });
  }
};

exports.getAllSeasonalityData = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const data = await SeasonalityData.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).send(data);
  } catch (error) {
    console.error("Error fetching seasonality data:", error);
    res.status(500).send({
      message: "Error fetching seasonality data",
      error: error.message,
    });
  }
};

exports.getSeasonalityDataById = async (req, res) => {
  try {
    const data = await SeasonalityData.findByPk(req.params.id);
    if (data) {
      res.status(200).send(data);
    } else {
      res.status(404).send({ message: "Seasonality data not found." });
    }
  } catch (error) {
    console.error("Error fetching seasonality data:", error);
    res.status(500).send({
      message: "Error fetching seasonality data",
      error: error.message,
    });
  }
};

exports.getActiveSeasonalityData = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = { isActive: true };
    if (userId) {
      whereClause.userId = userId;
    }

    const data = await SeasonalityData.findOne({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    if (data) {
      res.status(200).send(data);
    } else {
      res.status(404).send({ message: "No active seasonality data found." });
    }
  } catch (error) {
    console.error("Error fetching active seasonality data:", error);
    res.status(500).send({
      message: "Error fetching active seasonality data",
      error: error.message,
    });
  }
};

exports.updateSeasonalityData = async (req, res) => {
  try {
    const dataId = req.params.id;
    const { name, description, seasonalityData, isActive } = req.body;

    const data = await SeasonalityData.findByPk(dataId);
    if (!data) {
      return res.status(404).send({ message: "Seasonality data not found." });
    }

    // Update fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (seasonalityData !== undefined) updateData.seasonalityData = seasonalityData;
    if (isActive !== undefined) updateData.isActive = isActive;

    await data.update(updateData);

    res.status(200).send({
      message: "Seasonality data updated successfully.",
      data: data,
    });
  } catch (error) {
    console.error("Error updating seasonality data:", error);
    res.status(500).send({
      message: "Error updating seasonality data",
      error: error.message,
    });
  }
};

exports.deleteSeasonalityData = async (req, res) => {
  try {
    const deleted = await SeasonalityData.destroy({
      where: { id: req.params.id },
    });

    if (deleted === 1) {
      res.status(200).send({ message: "Seasonality data deleted successfully." });
    } else {
      res.status(404).send({ message: "Seasonality data not found." });
    }
  } catch (error) {
    console.error("Error deleting seasonality data:", error);
    res.status(500).send({
      message: "Error deleting seasonality data",
      error: error.message,
    });
  }
};

exports.getAllSeasonalityDataPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const { count, rows } = await SeasonalityData.findAndCountAll({
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
      message: "Error fetching paginated seasonality data",
      error: error.message,
    });
  }
};

