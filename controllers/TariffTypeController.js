const { TariffType } = require("../dbInit");

exports.getAllTariffTypes = async (req, res) => {
  try {
    const tariffTypes = await TariffType.findAll();
    res.send(tariffTypes);
  } catch (error) {
    res.status(500).send({ message: "Error retrieving tariff types." });
  }
};

// Get all tariff types with pagination
exports.getAllTariffTypesPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default 10 items per page
    const page = parseInt(req.query.page) || 0;    // Default page 0

    const { count, rows } = await TariffType.findAndCountAll({
      distinct: true,
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
    console.error("Error fetching paginated tariff types:", error);
    res.status(500).send({ 
      message: "Error retrieving tariff types.",
      error: error.message 
    });
  }
};

exports.createTariffType = async (req, res) => {
  try {
    const { name } = req.body;
    const newTariffType = await TariffType.create({ name });
    res.status(201).send(newTariffType);
  } catch (error) {
    res.status(500).send({ message: "Error creating new tariff type." });
  }
};

exports.updateTariffType = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await TariffType.update(req.body, { where: { id } });
    if (updated) {
      const updatedTariffType = await TariffType.findByPk(id);
      res.send(updatedTariffType);
    } else {
      res.status(404).send({ message: "Tariff type not found." });
    }
  } catch (error) {
    res.status(500).send({ message: "Error updating tariff type." });
  }
};

exports.deleteTariffType = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await TariffType.destroy({ where: { id } });
    if (deleted) {
      res.send({ message: "Tariff type deleted successfully." });
    } else {
      res.status(404).send({ message: "Tariff type not found." });
    }
  } catch (error) {
    console.error("Error during deletion:", error.name); // Log the error for debugging purposes

    // Check for foreign key constraint error
    if (error.name == "SequelizeForeignKeyConstraintError") {
      res.status(409).send({
        error:
          "Tariff type cannot be deleted because it is referenced by other records.",
      });
    } else {
      res
        .status(500)
        .send({ error: error.message || "Error deleting tariff type." });
    }
  }
};
