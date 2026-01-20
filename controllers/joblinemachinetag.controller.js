const { JobLineMachineTag, sequelize, Tags } = require("../dbInit");
// Fetch lines with corresponding machines
exports.getLinesWithMachines = async (req, res) => {
  try {
    // Fetch distinct lines
    const lines = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("lineId")), "lineId"],
        [sequelize.fn("max", sequelize.col("lineName")), "lineName"],
        [sequelize.fn("max", sequelize.col("locationId")), "locationId"],
        [
          sequelize.fn("max", sequelize.col("bottleneckMachineId")),
          "bottleneckMachineId",
        ],
      ],
      group: "lineId",
      raw: true,
    });

    // Fetch machines grouped by lineId, using distinct machines
    const machines = await JobLineMachineTag.findAll({
      attributes: [
        "lineId",
        "machineId",
        [sequelize.fn("max", sequelize.col("machineName")), "machineName"],
        [sequelize.fn("max", sequelize.col("machineType")), "machineType"],
      ],
      group: ["lineId", "machineId"],
      raw: true,
    });

    // Transform machines into a map of lineId -> machines array
    const machinesByLine = machines.reduce((acc, machine) => {
      if (!acc[machine.lineId]) {
        acc[machine.lineId] = [];
      }
      acc[machine.lineId].push({
        machineId: machine.machineId,
        machineName: machine.machineName,
        machineType: machine.machineType,
      });
      return acc;
    }, {});

    res.status(200).json({
      data: {
        lines,
        machines: machinesByLine,
      },
    });
  } catch (error) {
    console.error("Error fetching lines with machines:", error);
    res
      .status(500)
      .json({ message: "Error fetching lines with machines", error });
  }
};

exports.getLinesWithMachinesByLocation = async (req, res) => {
  try {
    const { locationId } = req.params;

    // Fetch distinct lines for the specific location
    const lines = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("lineId")), "lineId"],
        [sequelize.fn("max", sequelize.col("lineName")), "lineName"],
        [sequelize.fn("max", sequelize.col("locationId")), "locationId"],
        [sequelize.fn("max", sequelize.col("bottleneckMachineId")), "bottleneckMachineId"],
      ],
      where: {
        locationId: locationId
      },
      group: "lineId",
      raw: true,
    });

    // Fetch machines grouped by lineId for the specific location
    const machines = await JobLineMachineTag.findAll({
      where: {
        locationId: locationId
      },
      attributes: [
        "lineId",
        "machineId",
        [sequelize.fn("max", sequelize.col("machineName")), "machineName"],
        [sequelize.fn("max", sequelize.col("machineType")), "machineType"],
      ],
      group: ["lineId", "machineId"],
      raw: true,
    });

    // Transform machines into a map of lineId -> machines array
    const machinesByLine = machines.reduce((acc, machine) => {
      if (!acc[machine.lineId]) {
        acc[machine.lineId] = [];
      }
      acc[machine.lineId].push({
        machineId: machine.machineId,
        machineName: machine.machineName,
        machineType: machine.machineType,
      });
      return acc;
    }, {});

    res.status(200).json({
      data: {
        lines,
        machines: machinesByLine,
      },
    });
  } catch (error) {
    console.error("Error fetching lines with machines by location:", error);
    res.status(500).json({ message: "Error fetching lines with machines", error });
  }
};

// Fetch distinct machine tags
exports.getDistinctMachineTags = async (req, res) => {
  try {
    const machineTags = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("tagId")), "tagId"],
        "tagName",
        "ref",
      ],
    });
    res.status(200).json({ data: machineTags });
  } catch (error) {
    console.error("Error fetching distinct machine tags:", error);
    res.status(500).json({ error: "Failed to fetch distinct machine tags" });
  }
};

// Fetch tags of a specific line
exports.getTagsByLine = async (req, res) => {
  try {
    const lineTags = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("tagId")), "tagId"],
        "tagName",
      ],
      where: {
        lineId: req.params.lineId,
      },
    });
    res.status(200).json({ data: lineTags });
  } catch (error) {
    console.error("Error fetching tags for line:", error);
    res.status(500).json({ error: "Failed to fetch tags for line" });
  }
};

// Fetch all line tags
exports.getLineTags = async (req, res) => {
  try {
    const lineTags = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("tagId")), "tagId"],
        "tagName",
      ],
    });
    res.status(200).json({ data: lineTags });
  } catch (error) {
    console.error("Error fetching line tags:", error);
    res.status(500).json({ error: "Failed to fetch line tags" });
  }
};

// Fetch lines with corresponding machines and tags
exports.getLinesWithMachineTags = async (req, res) => {
  try {
    const linesWithTags = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("lineId")), "lineId"],
        "lineName",
        "machineId",
        "machineName",
        "tagId",
        "tagName",
      ],
    });
    res.status(200).json({ data: linesWithTags });
  } catch (error) {
    console.error("Error fetching lines with machine tags:", error);
    res.status(500).json({ error: "Failed to fetch lines with machine tags" });
  }
};

// Fetch machines by line ID
exports.getMachinesByLineId = async (req, res) => {
  try {
    const machines = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("machineId")), "machineId"],
        "machineName",
      ],
      where: {
        lineId: req.params.lineId,
      },
    });
    res.status(200).json({ data: machines });
  } catch (error) {
    console.error("Error fetching machines by line ID:", error);
    res.status(500).json({ error: "Failed to fetch machines by line ID" });
  }
};

// Fetch all lines
exports.getLines = async (req, res) => {
  try {
    const lines = await JobLineMachineTag.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("lineId")), "lineId"],
        "lineName",
      ],
    });
    res.status(200).json({ data: lines });
  } catch (error) {
    console.error("Error fetching lines:", error);
    res.status(500).json({ error: "Failed to fetch lines" });
  }
};
