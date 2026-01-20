const db = require("../dbInit");
const { MonthlyForecast, Op } = db;

exports.createMonthlyForecast = async (req, res) => {
  try {
    const { name, description, forecastData, userId } = req.body;

    // Validate required fields
    if (!forecastData) {
      return res.status(400).send({ message: "forecastData is required" });
    }

    // Check if a forecast with the same name already exists for this user (if userId provided)
    if (name && userId) {
      const existingForecast = await MonthlyForecast.findOne({
        where: {
          name,
          userId,
        },
      });
      if (existingForecast) {
        return res.status(400).send({ message: "A forecast with this name already exists" });
      }
    }

    const forecast = await MonthlyForecast.create({
      name: name || "Monthly Forecast",
      description: description || null,
      forecastData,
      userId: userId || null,
      isActive: true,
    });

    res.status(201).send(forecast);
  } catch (error) {
    console.error("Error creating monthly forecast:", error);
    res.status(500).send({
      message: "Error creating monthly forecast",
      error: error.message,
    });
  }
};

exports.getAllMonthlyForecasts = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const forecasts = await MonthlyForecast.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    res.status(200).send(forecasts);
  } catch (error) {
    console.error("Error fetching monthly forecasts:", error);
    res.status(500).send({
      message: "Error fetching monthly forecasts",
      error: error.message,
    });
  }
};

exports.getMonthlyForecastById = async (req, res) => {
  try {
    const forecast = await MonthlyForecast.findByPk(req.params.id);
    if (forecast) {
      res.status(200).send(forecast);
    } else {
      res.status(404).send({ message: "Monthly forecast not found." });
    }
  } catch (error) {
    console.error("Error fetching monthly forecast:", error);
    res.status(500).send({
      message: "Error fetching monthly forecast",
      error: error.message,
    });
  }
};

exports.getActiveMonthlyForecast = async (req, res) => {
  try {
    const { userId } = req.query;

    const whereClause = { isActive: true };
    if (userId) {
      whereClause.userId = userId;
    }

    const forecast = await MonthlyForecast.findOne({
      where: whereClause,
      order: [["createdAt", "DESC"]],
    });

    if (forecast) {
      res.status(200).send(forecast);
    } else {
      res.status(404).send({ message: "No active monthly forecast found." });
    }
  } catch (error) {
    console.error("Error fetching active monthly forecast:", error);
    res.status(500).send({
      message: "Error fetching active monthly forecast",
      error: error.message,
    });
  }
};

exports.updateMonthlyForecast = async (req, res) => {
  try {
    const forecastId = req.params.id;
    const { name, description, forecastData, isActive } = req.body;

    const forecast = await MonthlyForecast.findByPk(forecastId);
    if (!forecast) {
      return res.status(404).send({ message: "Monthly forecast not found." });
    }

    // Update fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (forecastData !== undefined) updateData.forecastData = forecastData;
    if (isActive !== undefined) updateData.isActive = isActive;

    await forecast.update(updateData);

    res.status(200).send({
      message: "Monthly forecast updated successfully.",
      forecast: forecast,
    });
  } catch (error) {
    console.error("Error updating monthly forecast:", error);
    res.status(500).send({
      message: "Error updating monthly forecast",
      error: error.message,
    });
  }
};

exports.deleteMonthlyForecast = async (req, res) => {
  try {
    const deleted = await MonthlyForecast.destroy({
      where: { id: req.params.id },
    });

    if (deleted === 1) {
      res.status(200).send({ message: "Monthly forecast deleted successfully." });
    } else {
      res.status(404).send({ message: "Monthly forecast not found." });
    }
  } catch (error) {
    console.error("Error deleting monthly forecast:", error);
    res.status(500).send({
      message: "Error deleting monthly forecast",
      error: error.message,
    });
  }
};

exports.getAllMonthlyForecastsPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { userId } = req.query;

    const whereClause = {};
    if (userId) {
      whereClause.userId = userId;
    }

    const { count, rows } = await MonthlyForecast.findAndCountAll({
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
      message: "Error fetching paginated monthly forecasts",
      error: error.message,
    });
  }
};

