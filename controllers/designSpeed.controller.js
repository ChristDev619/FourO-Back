const db = require("../dbInit");
const { DesignSpeed } = db;

exports.getAllDesignSpeeds = async (req, res) => {
  try {
    const designSpeeds = await DesignSpeed.findAll();
    res.status(200).send(designSpeeds);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getDesignSpeedsByMachineId = async (req, res) => {
  const { machineId } = req.params;

  try {
    const designSpeeds = await DesignSpeed.findAll({
      where: { machineId },
    });
    res.status(200).send(designSpeeds);
  } catch (error) {
    res.status(500).send(error);
  }
};


exports.getDesignSpeedsByMachineId = async (req, res) => {
  const { machineId } = req.params;

  try {
    const designSpeeds = await DesignSpeed.findAll({
      where: { machineId },
      order: [['value', 'ASC']], // Sorting from lowest to highest
    });

    if (!designSpeeds || designSpeeds.length === 0) {
      return res.status(404).send({ message: "No design speeds found for this machine." });
    }

    res.status(200).send(designSpeeds);
  } catch (error) {
    res.status(500).send({ message: "Error fetching design speeds.", error });
  }
};