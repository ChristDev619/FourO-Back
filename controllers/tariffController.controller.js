const { Tariff, sequelize , Op} = require("../dbInit");

// Create a new tariff
exports.createTariff = async (req, res) => {
  try {
    const { tariffName } = req.body;

    // Check if a tariff with the same name already exists
    const existingTariff = await Tariff.findOne({ where: { tariffName } });

    if (existingTariff) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Create a new tariff if no duplicate exists
    const tariff = await Tariff.create(req.body);
    res.status(201).send(tariff);
  } catch (error) {
    console.error("Error creating tariff:", error);
    res.status(500).send({ message: "An error occurred while creating the tariff." });
  }
};

// Get all tariffs
exports.getAllTariffs = async (req, res) => {
  try {
    const tariffs = await Tariff.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.status(200).send(tariffs);
  } catch (error) {
    res.status(500).send(error);
  }
};

// Get tariff by ID
exports.getTariffById = async (req, res) => {
  try {
    const tariff = await Tariff.findByPk(req.params.id);
    if (tariff) {
      res.status(200).send(tariff);
    } else {
      res.status(404).send({ message: "Tariff not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

// Update a tariff
exports.updateTariff = async (req, res) => {
  try {
    const { tariffName } = req.body;
    const tariffId = req.params.id;

    // Check if the tariff exists
    const tariff = await Tariff.findByPk(tariffId);
    if (!tariff) {
      return res.status(404).send({ message: "Tariff not found." });
    }

    // Check if another tariff with the same name already exists (excluding the current tariff)
    const existingTariff = await Tariff.findOne({
      where: {
        id: { [Op.ne]: tariffId }, // Exclude the current tariff
        tariffName, // Check for duplicate name
      },
    });

    if (existingTariff) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Proceed with update
    await tariff.update(req.body);

      res.status(200).send({ message: "Tariff updated successfully." });
  } catch (error) {
    console.error("Error updating tariff:", error);
    res.status(500).send({ message: "An error occurred while updating the tariff." });
  }
};

// Delete a tariff
exports.deleteTariff = async (req, res) => {
  try {
    const tariff = await Tariff.destroy({
      where: { id: req.params.id },
    });
    if (tariff == 1) {
      res.status(200).send({ message: "Tariff deleted successfully." });
    } else {
      res.status(404).send({ message: "Tariff not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

// Get all tariffs with pagination
exports.getAllTariffsPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default to 10 tariffs per page if not specified
    const page = parseInt(req.query.page) || 0; // Default to page 0 if not specified

    const { count, rows } = await Tariff.findAndCountAll({
      include: [
        {
          model: sequelize.models.TariffType, // Assuming TariffType is the correct model name
          as: "type", // Assuming 'type' is the alias set in the Tariff model associations
          attributes: ["id", "name"], // Only fetch id and name from TariffType
        },
      ],
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
    console.error("Error fetching tariffs with pagination:", error);
    res.status(500).send(error);
  }
};

// Get tariffs by date
exports.getTariffsByDate = async (req, res) => {
  try {
    const date = req.params.date;
    const tariffs = await Tariff.findAll({
      where: sequelize.where(sequelize.fn("date", sequelize.col("date")), date),
    });
    res.status(200).send({ data: tariffs });
  } catch (error) {
    console.log(error);
    res.status(500).send({ message: "Error fetching tariffs by date", error });
  }
};
