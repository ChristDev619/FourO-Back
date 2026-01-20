const db = require("../dbInit");
const { Status } = db;
const logger = require("../utils/logger");

exports.createStatus = async (req, res) => {
  try {
    const status = await Status.create(req.body);
    res.status(201).send(status);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).send({ message: "exists" });
    }
    res.status(500).send({ message: "An error occurred.", error });
  }
};

exports.getAllStatuses = async (req, res) => {
  try {
    const statuses = await Status.findAll();
    res.status(200).send(statuses);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getStatusById = async (req, res) => {
  try {
    const status = await Status.findByPk(req.params.id);
    if (status) {
      res.status(200).send(status);
    } else {
      res.status(404).send({ message: "Status not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const status = await Status.update(req.body, {
      where: { id: req.params.id },
    });
    if (status == 1) {
      res.status(200).send({ message: "Status updated successfully." });
    } else {
      res.status(404).send({ message: "Status not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.deleteStatus = async (req, res) => {
  try {
    const status = await Status.destroy({
      where: { id: req.params.id },
    });
    if (status == 1) {
      res.status(200).send({ message: "Status deleted successfully." });
    } else {
      res.status(404).send({ message: "Status not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllStatusesPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { count, rows } = await Status.findAndCountAll({
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
    res.status(500).send(error);
  }
};

exports.bulkInsertStatuses = async (req, res) => {
  try {
    const statuses = req.body;

    if (!statuses || statuses.length === 0) {
      return res.status(400).json({ message: "No data to insert." });
    }

    // Extract names from incoming data
    const incomingNames = statuses.map((status) => status.name);

    // Find existing statuses in the database
    const existingStatuses = await Status.findAll({
      where: { name: incomingNames },
      attributes: ["name"], // Retrieve only names
    });

    // Extract existing names
    const existingNames = existingStatuses.map((status) => status.name);

    // Filter out the new statuses that are not in the existing list
    const newStatuses = statuses.filter((status) => !existingNames.includes(status.name));

    if (newStatuses.length > 0) {
      await Status.bulkCreate(newStatuses);
    }

    return res.status(201).json({
        message: "Statuses bulk insert successfully!",
      inserted: newStatuses.map((s) => s.name), // Inserted status names
      existing: existingNames, // Already existing names
    });
  } catch (error) {
    logger.error("Error inserting statuses", { error: error.message, stack: error.stack });
    return res.status(500).json({
      message: "Failed to insert statuses",
      error: error.message,
    });
  }
};
