const db = require("../dbInit");
const { Generator , Op } = db;

exports.createGenerator = async (req, res) => {
  try {
    const { name, locationId } = req.body;

    // Check if a generator with the same name already exists in the same location
    const existingGenerator = await Generator.findOne({ where: { name, locationId } });

    if (existingGenerator) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Create a new generator if no duplicate exists
    const generator = await Generator.create(req.body);
    res.status(201).send(generator);
  } catch (error) {
    console.error("Error creating generator:", error);
    res.status(500).send({ message: "An error occurred while creating the generator." });
  }
};

exports.getAllGenerators = async (req, res) => {
  try {
    const generators = await Generator.findAll();
    res.status(200).send(generators);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getGeneratorById = async (req, res) => {
  try {
    const generator = await Generator.findByPk(req.params.id);
    if (generator) {
      res.status(200).send(generator);
    } else {
      res.status(404).send({ message: "Generator not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateGenerator = async (req, res) => {
  try {
        const { id } = req.params; // Get generator ID from request params
        const { name, locationId } = req.body; // Get new generator name and location

        // Check if the generator exists
        const generator = await Generator.findByPk(id);
        if (!generator) {
            return res.status(404).send({ message: "Generator not found." });
        }

        // Check if another generator with the same name already exists in the same location
        const existingGenerator = await Generator.findOne({
            where: { name, locationId, id: { [Op.ne]: id } }, // Exclude the current generator
    });

        if (existingGenerator) {
            return res.status(400).send({ message: "exists" });
    }

        // Update the generator
        await generator.update(req.body);
        res.status(200).send({ message: "Generator updated successfully" });

  } catch (error) {
        console.error("Error updating generator:", error);
        res.status(500).send({ message: "An error occurred while updating the generator." });
  }
};


exports.deleteGenerator = async (req, res) => {
  try {
    const generator = await Generator.destroy({
      where: { id: req.params.id },
    });
    if (generator == 1) {
      res.status(200).send({ message: "Generator deleted successfully." });
    } else {
      res.status(404).send({ message: "Generator not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getGeneratorsWithPagination = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10; // number of records per page
    const page = parseInt(req.query.page, 10) || 0; // page number

    const generators = await Generator.findAndCountAll({
      limit: limit,
      offset: page * limit,
      include: [
        "location",
        {
          model: db.sequelize.models.TariffType, // Assuming TariffType is the correct model name
          as: "tariffType", // Assuming 'type' is the alias set in the Tariff model associations
          attributes: ["id", "name"], // Only fetch id and name from TariffType
        },
      ], // Assuming you want to include location details
      distinct: true,
      order: [["createdAt", "DESC"]], // Adjust or remove if createdAt is not defined or not needed
    });

    res.status(200).send({
      total: generators.count,
      pages: Math.ceil(generators.count / limit),
      data: generators.rows,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};

exports.getGeneratorsByLocationId = async (req, res) => {
  try {
    const locationId = req.params.locationId;

    const generators = await Generator.findAll({
      where: { locationId: locationId },
      include: ["location"], // Includes the location details in the response
    });

    res.status(200).send({ data: generators });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getGeneratorsByTariffType = async (req, res) => {
  const { tariffTypeId } = req.params;

  try {
    const generators = await Generator.findAll({
      where: { tariffTypeId },
    });
    res.status(200).send(generators);
  } catch (error) {
    res.status(500).send(error);
  }
};
