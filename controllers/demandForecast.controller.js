const db = require("../dbInit");
const { DemandForecast, Op } = db;

exports.createDemandForecast = async (req, res) => {
  try {
    const { name, description, forecastData, userId } = req.body;

    // Validate required fields
    if (!forecastData) {
      return res.status(400).send({ message: "forecastData is required" });
    }

    // Check if a forecast with the same name already exists for this user (if userId provided)
    if (name && userId) {
      const existingForecast = await DemandForecast.findOne({
        where: {
          name,
          userId,
        },
      });
      if (existingForecast) {
        return res.status(400).send({ message: "A forecast with this name already exists" });
      }
    }

    const forecast = await DemandForecast.create({
      name: name || "Demand Forecast",
      description: description || null,
      forecastData,
      userId: userId || null,
      isActive: true,
    });

    res.status(201).send(forecast);
  } catch (error) {
    console.error("Error creating demand forecast:", error);
    res.status(500).send({
      message: "Error creating demand forecast",
      error: error.message,
    });
  }
};

exports.getAllDemandForecasts = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const forecasts = await DemandForecast.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).send(forecasts);
  } catch (error) {
    console.error("Error fetching demand forecasts:", error);
    res.status(500).send({
      message: "Error fetching demand forecasts",
      error: error.message,
    });
  }
};

exports.getDemandForecastById = async (req, res) => {
  try {
    const forecast = await DemandForecast.findByPk(req.params.id);
    if (forecast) {
      res.status(200).send(forecast);
    } else {
      res.status(404).send({ message: "Demand forecast not found." });
    }
  } catch (error) {
    console.error("Error fetching demand forecast:", error);
    res.status(500).send({
      message: "Error fetching demand forecast",
      error: error.message,
    });
  }
};

exports.getActiveDemandForecast = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = { isActive: true };
    if (userId) {
      whereClause.userId = userId;
    }

    const forecast = await DemandForecast.findOne({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    if (forecast) {
      res.status(200).send(forecast);
    } else {
      res.status(404).send({ message: "No active demand forecast found." });
    }
  } catch (error) {
    console.error("Error fetching active demand forecast:", error);
    res.status(500).send({
      message: "Error fetching active demand forecast",
      error: error.message,
    });
  }
};

exports.updateDemandForecast = async (req, res) => {
  try {
    const forecastId = req.params.id;
    const { name, description, forecastData, isActive } = req.body;

    const forecast = await DemandForecast.findByPk(forecastId);
    if (!forecast) {
      return res.status(404).send({ message: "Demand forecast not found." });
    }

    // Update fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (forecastData !== undefined) updateData.forecastData = forecastData;
    if (isActive !== undefined) updateData.isActive = isActive;

    await forecast.update(updateData);

    res.status(200).send({
      message: "Demand forecast updated successfully.",
      forecast: forecast,
    });
  } catch (error) {
    console.error("Error updating demand forecast:", error);
    res.status(500).send({
      message: "Error updating demand forecast",
      error: error.message,
    });
  }
};

exports.deleteDemandForecast = async (req, res) => {
  try {
    const deleted = await DemandForecast.destroy({
      where: { id: req.params.id },
    });

    if (deleted === 1) {
      res.status(200).send({ message: "Demand forecast deleted successfully." });
    } else {
      res.status(404).send({ message: "Demand forecast not found." });
    }
  } catch (error) {
    console.error("Error deleting demand forecast:", error);
    res.status(500).send({
      message: "Error deleting demand forecast",
      error: error.message,
    });
  }
};

exports.getAllDemandForecastsPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const { count, rows } = await DemandForecast.findAndCountAll({
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
      message: "Error fetching paginated demand forecasts",
      error: error.message,
    });
  }
};

