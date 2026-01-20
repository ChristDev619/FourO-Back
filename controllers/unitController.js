// controllers/unitController.js

const { Unit ,Op } = require("../dbInit");
const logger = require("../utils/logger");


exports.createUnit = async (req, res) => {
  try {
    const { name } = req.body;

    // Check if a unit with the same name already exists
    const existingUnit = await Unit.findOne({ where: { name } });

    if (existingUnit) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Create a new unit if no duplicate exists
    const unit = await Unit.create(req.body);
    res.status(201).send(unit);
  } catch (error) {
    logger.error("Error creating unit", { error: error.message, stack: error.stack });
    res.status(500).send({ message: "An error occurred while creating the unit." });
  }
};

exports.getAllUnits = async (req, res) => {
  try {
    const units = await Unit.findAll();
    res.status(200).send(units);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getUnitById = async (req, res) => {
  try {
    const unit = await Unit.findByPk(req.params.id);
    if (unit) {
      res.status(200).send(unit);
    } else {
      res.status(404).send({ message: "Unit not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateUnit = async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;

    // Check if the unit exists
    const unit = await Unit.findByPk(id);
    if (!unit) {
      return res.status(404).send({ message: "Unit not found." });
    }

    // Check if a unit with the same name already exists (excluding the current unit)
    const existingUnit = await Unit.findOne({ where: { name, id: { [Op.ne]: id } } });
    if (existingUnit) {
      return res.status(400).send({ message: "exists" });
    }

    // Proceed with the update
    await unit.update(req.body);
      res.status(200).send({ message: "Unit updated successfully." });

  } catch (error) {
    logger.error("Error updating unit", { error: error.message, stack: error.stack });
    res.status(500).send({ message: "An error occurred while updating the unit." });
  }
};

exports.deleteUnit = async (req, res) => {
  try {
    const unit = await Unit.destroy({
      where: { id: req.params.id },
    });
    if (unit == 1) {
      res.status(200).send({ message: "Unit deleted successfully." });
    } else {
      res.status(404).send({ message: "Unit not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllUnitsPaginated = async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10; // Default to 10 units per page if not specified
      const page = parseInt(req.query.page) || 0; // Default to page 0 if not specified
      const { count, rows } = await Unit.findAndCountAll({
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
