const db = require("../dbInit");
const { Meters , Op } = db;

exports.createMeter = async (req, res) => {

  const transaction = await db.sequelize.transaction(); // Start a transaction

  try {

    const { name, generators } = req.body; // Extracting name and generators
 
    // Check if a meter with the same name already exists

    const existingMeter = await Meters.findOne({ where: { name } });
 
    if (existingMeter) {

      await transaction.rollback(); // Rollback transaction if duplicate exists

      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry

    }
 
    // Create the meter

    const meter = await Meters.create(req.body, { transaction });
 
    // If generators are provided, associate them with the new meter

    if (generators && generators.length) {

      await meter.addGenerators(generators, { transaction }); // Sequelize n:m association method

    }
 
    await transaction.commit(); // Commit the transaction

    res.status(201).send(meter);

  } catch (error) {

    await transaction.rollback(); // Rollback transaction in case of error

    console.error("Error creating meter:", error);

    res.status(500).send({ message: "An error occurred while creating the meter." });

  }

};

exports.getAllMeters = async (req, res) => {
  try {
    const meters = await Meters.findAll({
      include: ["machine", "location", "generators"], // Include the generators association
    });
    res.status(200).send(meters);
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};

exports.getMeterById = async (req, res) => {
  try {
    const meter = await Meters.findByPk(req.params.id, {
      include: ["machine", "location", "generators"], // Include the generators association
    });
    if (meter) {
      res.status(200).send(meter);
    } else {
      res.status(404).send({ message: "Meter not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};
  
exports.updateMeter = async (req, res) => {
  const transaction = await db.sequelize.transaction(); // Start a transaction

  try {
    const { id } = req.params; // Get meter ID from request params
    const { name, generators } = req.body; // Get meter name and generators from request body

    // Check if the meter exists
    const meter = await Meters.findByPk(id, { transaction });
    if (!meter) {
      await transaction.rollback();
      return res.status(404).send({ message: "Meter not found" });
    }

    // Check if another meter with the same name already exists (excluding the current meter)
    const existingMeter = await Meters.findOne({ 
      where: { name, id: { [Op.ne]: id } },
      transaction 
    });
    if (existingMeter) {
      await transaction.rollback();
      return res.status(400).send({ message: "exists" });
    }

    // Update the meter basic fields
    await meter.update(req.body, { transaction });

    // Handle generators relationship if provided
    if (generators !== undefined) {
      // Remove all existing generator associations
      await meter.setGenerators([], { transaction });
      
      // Add new generator associations if any
      if (generators && generators.length > 0) {
        await meter.addGenerators(generators, { transaction });
      }
    }

    await transaction.commit(); // Commit the transaction

    res.status(200).send({ message: "Meter updated successfully" });

  } catch (error) {
    await transaction.rollback(); // Rollback transaction in case of error
    console.error("Error updating meter:", error);
    res.status(500).send({ message: "An error occurred while updating the meter." });
  }
};

exports.deleteMeter = async (req, res) => {
  try {
    const meter = await Meters.destroy({
      where: { id: req.params.id },
    });
    if (meter == 1) {
      res.status(200).send({ message: "Meter deleted successfully." });
    } else {
      res.status(404).send({ message: "Meter not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getMetersByLocationId = async (req, res) => {
  try {
    const locationId = req.params.locationId;
    const meters = await Meters.findAll({
      where: { locationId: locationId },
      include: ["machine", "location", "generators"], // Include the generators association
    });

    res.status(200).send({ data: meters });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllMetersPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // number of records per page
    const page = parseInt(req.query.page) || 0; // start index for the current page
    const { count, rows } = await Meters.findAndCountAll({
      limit,
      offset: page * limit,
      include: ["machine", "location", "generators"], // Include the generators association
      distinct: true,
      order: [["createdAt", "DESC"]],
    });
    res.status(200).send({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};

exports.getMetersByLocIdAndGenId = async (req, res) => {
  const { generatorIds, locationId } = req.body;
  try {
    const meters = await Meters.findAll({
      where: { locationId },
      include: [
        {
          model: db.Generators,
          as: "generators",
          where: { id: generatorIds },
          through: { attributes: [] }, // Do not include join table attributes
        },
      ],
    });
    res.json({ data: meters });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.metersByTariffTypeIdAndUnit = async (req, res) => {
  const { tariffTypeId, unit } = req.query; // Since you are getting it from query, not body

  try {
    const meters = await db.GeneratorMachineMeterTagValues.findAll({
      where: {
        meter_type: "generator",
        tariff_type_id: tariffTypeId,
        tag_unit_id: unit,
      },
      attributes: [
        [db.sequelize.fn("DISTINCT", db.sequelize.col("meter_id")), "meter_id"],
        "meter_name",
        "meter_type",
        "tag_id",
        "tag_name",
        "tag_unit_id",
        "kwhPerLiter",
        "generator_id",
      ],
      group: [
        "meter_id",
        "meter_name",
        "meter_type",
        "tag_id",
        "tag_name",
        "tag_unit_id",
        "kwhPerLiter",
        "generator_id",
      ], // Ensures distinct records by these fields
    });

    res.json(meters);
  } catch (error) {
    console.error("Failed to fetch meters:", error);
    res.status(500).send("Server error");
  }
};
