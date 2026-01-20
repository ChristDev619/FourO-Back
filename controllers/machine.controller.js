const db = require("../dbInit");
const { Machine, DesignSpeed } = db;

exports.createMachine = async (req, res) => {
  const { designSpeeds, ...machineData } = req.body; // Extract designSpeeds array from request body

  try {
    const machine = await Machine.create(machineData);

    if (designSpeeds && designSpeeds.length > 0) {
      // Create design speeds for the machine
      const designSpeedRecords = designSpeeds.map((value) => ({
        value,
        machineId: machine.id,
      }));
      await DesignSpeed.bulkCreate(designSpeedRecords);
    }

    res.status(201).send(machine);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.getAllMachines = async (req, res) => {
  try {
    const machines = await Machine.findAll();
    res.status(200).send(machines);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getMachineById = async (req, res) => {
  try {
    const machine = await Machine.findByPk(req.params.id);
    if (machine) {
      res.status(200).send(machine);
    } else {
      res.status(404).send({ message: "Machine not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateMachine = async (req, res) => {
  const { designSpeeds, ...machineData } = req.body;

  try {
    const machine = await Machine.findByPk(req.params.id);
    if (!machine) {
      return res.status(404).send({ message: "Machine not found." });
    }

    await machine.update(machineData);

    // Remove existing design speeds and create new ones
    await DesignSpeed.destroy({ where: { machineId: machine.id } });
    if (designSpeeds && designSpeeds.length > 0) {
      const designSpeedRecords = designSpeeds.map((value) => ({
        value,
        machineId: machine.id,
      }));
      await DesignSpeed.bulkCreate(designSpeedRecords);
    }

    res.status(200).send({ message: "Machine updated successfully." });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.deleteMachine = async (req, res) => {
  try {
    const machine = await Machine.findByPk(req.params.id);
    if (!machine) {
      return res.status(404).send({ message: "Machine not found." });
    }

    // Delete associated design speeds
    await DesignSpeed.destroy({ where: { machineId: machine.id } });

    // Delete the machine
    await machine.destroy();

    res.status(200).send({ message: "Machine deleted successfully." });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllMachinesPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default to 10 machines per page if not specified
    const page = parseInt(req.query.page) || 0; // Default to page 0 if not specified
    const { count, rows } = await Machine.findAndCountAll({
      limit,
      offset: page * limit,
      include: ["location"],
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

exports.getMachinesByLocationId = async (req, res) => {
  try {
    const locationId = req.params.locationId;
    const machines = await Machine.findAll({
      where: { locationId: locationId },
      include: ["location"],
    });
    res.status(200).send({ data: machines });
  } catch (error) {
    res.status(500).send(error);
  }
};
