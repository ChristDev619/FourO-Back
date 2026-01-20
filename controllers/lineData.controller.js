const db = require("../dbInit");
const { LineData, Op } = db;

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

