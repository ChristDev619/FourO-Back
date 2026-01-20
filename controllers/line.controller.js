const db = require("../dbInit");
const { Line, Machine, LineMachine, Location } = db;

// Create a new Line
exports.createLine = async (req, res) => {
  try {
    const { name, locationId, bottleneckMachineId, machineIds } = req.body;

    // Ensure required fields are provided
    if (!name || !locationId) {
      return res.status(400).send({ message: "Line name and location are required." });
    }

    // Check if a line with the same name already exists in the same location
    const existingLine = await Line.findOne({ where: { name, locationId } });

    if (existingLine) {
      return res.status(400).send({ message: "exists" });
    }

    // Create the new line
    const newLine = await Line.create({
      name,
      locationId,
      bottleneckMachineId,
    });

    // Handle the machines associated with the line
    if (machineIds && machineIds.length > 0) {
      const lineMachines = machineIds.map((machineId) => ({
        lineId: newLine.id,
        machineId,
        startDate: new Date(),
      }));

      // Bulk create entries in the LineMachine table for the many-to-many relation
      await LineMachine.bulkCreate(lineMachines);
    }

    res.status(201).send(newLine);
  } catch (error) {
    console.error("Error creating line:", error);
    res.status(500).send({ message: "An error occurred while creating the line." });
  }
};

// Retrieve all Lines
exports.getAllLines = async (req, res) => {
  try {
    const lines = await Line.findAll();
    res.status(200).send(lines);
  } catch (error) {
    res.status(500).send(error);
  }
};

// Retrieve a single Line by ID
exports.getLineById = async (req, res) => {
  try {
    const line = await Line.findByPk(req.params.id, {
      include: [{ model: Machine, as: "machines" }],
    });
    if (line) {
      res.status(200).send(line);
    } else {
      res.status(404).send({ message: "Line not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

// Update a Line by ID
exports.updateLine = async (req, res) => {
  const {
    name,
    locationId,
    skuId,
    bottleneckMachineId,
    machineIds,
    numberOfContainersPerPack,
  } = req.body;
  const lineId = req.params.id;

  try {
    // Check if the line exists
    const line = await Line.findByPk(lineId);
    if (!line) {
      return res.status(404).send({ message: "Line not found." });
    }

    // Check if another line with the same name and location already exists
    const existingLine = await Line.findOne({
      where: {
        id: { [db.Sequelize.Op.ne]: lineId }, // Exclude the current line
        name,
        locationId, // Ensure uniqueness within the same location
      },
    });

    if (existingLine) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Update the line details
    await line.update({
      name,
      locationId,
      skuId,
      bottleneckMachineId,
      numberOfContainersPerPack,
    });

    // Remove existing machines associated with this line in LineMachine table
    await LineMachine.destroy({
      where: { lineId },
    });

    // Re-add the new set of machines
    if (machineIds && machineIds.length > 0) {
      const lineMachineData = machineIds.map((machineId) => ({
        lineId,
        machineId,
        startDate: new Date(),
      }));

      await LineMachine.bulkCreate(lineMachineData);
    }

    res.status(200).send({ message: "Line updated successfully." });
  } catch (error) {
    console.error("Error updating line:", error);
    res.status(500).send({ message: "Failed to update line.", error });
  }
};

// Delete a Line by ID
exports.deleteLine = async (req, res) => {
  try {
    const line = await Line.destroy({
      where: { id: req.params.id },
    });

    if (line === 1) {
      res.status(200).send({ message: "Line deleted successfully." });
    } else {
      res.status(404).send({ message: "Line not found." });
    }
  } catch (error) {
    if (error.name === "SequelizeForeignKeyConstraintError") {
      // Handle foreign key constraint error
      res.status(400).send({
        message: "Cannot delete line as it is associated with other entities.",
      });
    } else {
      res.status(500).send({
        message: "An error occurred while trying to delete the line.",
        error: error.message,
      });
    }
  }
};

// Add a Machine to a Line
exports.addMachineToLine = async (req, res) => {
  try {
    const { machineId, startDate } = req.body;
    const lineId = req.params.lineId;

    // Check if the machine exists
    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).send({ message: "Machine not found." });
    }

    // Add machine to line through the LineMachine table
    const lineMachine = await LineMachine.create({
      lineId,
      machineId,
      startDate,
    });

    res.status(201).send(lineMachine);
  } catch (error) {
    res.status(500).send(error);
  }
};

// Remove a Machine from a Line
exports.removeMachineFromLine = async (req, res) => {
  try {
    const { machineId } = req.body;
    const lineId = req.params.lineId;

    // Find the LineMachine entry and remove it
    const lineMachine = await LineMachine.findOne({
      where: { lineId, machineId, endDate: null },
    });

    if (!lineMachine) {
      return res
        .status(404)
        .send({ message: "Machine not found on this line." });
    }

    // Set the endDate to mark the machine as removed
    lineMachine.endDate = new Date();
    await lineMachine.save();

    res.status(200).send({ message: "Machine removed from line." });
  } catch (error) {
    res.status(500).send(error);
  }
};

// Retrieve all machines currently attached to a Line
exports.getMachinesForLine = async (req, res) => {
  try {
    const lineId = req.params.lineId;

    const machines = await Machine.findAll({
      include: {
        model: Line,
        as: "lines",
        where: { id: lineId },
        through: { where: { endDate: null } }, // Only machines currently assigned
      },
    });

    res.status(200).send(machines);
  } catch (error) {
    res.status(500).send(error);
  }
};

// Retrieve all Lines with machines, paginated
exports.getAllLinesPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // Default to 10 lines per page if not specified
    const page = parseInt(req.query.page) || 0; // Default to page 0 if not specified

    const { count, rows } = await Line.findAndCountAll({
      distinct: true,
      limit,
      offset: page * limit,
      include: [
        { model: Machine, as: "machines" },
        { model: Machine, as: "bottleneckMachine" },
        { model: Location, as: "location" },
      ],
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

exports.getLineByName = async (req, res) => {
  try {
    const line = await Line.findOne({ where: { lineName: req.params.name } });
    if (line) {
      res.status(200).send(line);
    } else {
      res.status(404).send({ message: "Line not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};


exports.getLineTags = async (req, res) => {
  try {
    const { lineId } = req.params; // Assuming the lineId is passed as a route parameter

    if (!lineId) {
      return res.status(400).json({ message: "lineId is required" });
    }

    // Step 1: Get unique tagIds and tagNames for machines related to the lineId
    const machineTags = await db.JobLineMachineTag.findAll({
      attributes: [
        "tagId",
        "tagName",
      ],
      where: { lineId },
      group: ["tagId", "tagName"], // Ensure distinct values
    });

    const machineTagsArray = machineTags.map((tag) => ({
      tagId: tag.tagId,
      tagName: tag.tagName,
    }));

    // Step 2: Get tags directly associated with the line from the Tags model
    const lineTags = await db.Tags.findAll({
      attributes: ["id", "name"], // Assuming these are the correct column names
      where: {
        taggableType: "line",
        taggableId: lineId,
      },
    });

    const lineTagsArray = lineTags.map((tag) => ({
      tagId: tag.id,
      tagName: tag.name,
    }));

    // Step 3: Merge the results into a single array
    const tags = [...machineTagsArray, ...lineTagsArray];

    // Step 4: Return the combined tags array
    res.status(200).json({ tags });
  } catch (error) {
    console.error("Error fetching line tags:", error);
    res.status(500).json({ message: "Server error while fetching tags" });
  }
};

// Add this function to line.controller.js

exports.getLinesByLocation = async (req, res) => {
  try {
    const { locationId } = req.params;

    const lines = await Line.findAll({
      where: { locationId: locationId },
      include: [
        {
          model: Machine,
          as: "bottleneckMachine",
          attributes: ["id", "name"],
        },
        {
          model: Location,
          as: "location",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!lines) {
      return res.status(404).json({ message: "No lines found for this location" });
    }

    res.status(200).json(lines);
  } catch (error) {
    console.error("Error fetching lines by location:", error);
    res.status(500).json({ message: "Failed to fetch lines", error: error.message });
  }
};

// Get all lines for a given parent location (plant) - NEW for Line Data page
exports.getLinesByPlant = async (req, res) => {
  try {
    const plantId = req.params.plantId;

    if (!plantId) {
      return res.status(400).send({ message: "Plant ID is required" });
    }

    // Get all child locations of this plant
    const childLocations = await Location.findAll({
      where: { parentLocationId: plantId },
      attributes: ['id', 'name'],
    });

    if (!childLocations || childLocations.length === 0) {
      return res.status(200).send([]); // No child locations, return empty array
    }

    const locationIds = childLocations.map(loc => loc.id);

    // Get all lines in these locations
    const lines = await Line.findAll({
      where: {
        locationId: {
          [db.Sequelize.Op.in]: locationIds,
        },
      },
      include: [
        {
          model: Location,
          as: 'location',
          attributes: ['id', 'name', 'parentLocationId'],
        },
        {
          model: Machine,
          as: "bottleneckMachine",
          attributes: ["id", "name"],
        },
      ],
      order: [['name', 'ASC']],
    });

    res.status(200).send(lines);
  } catch (error) {
    console.error("Error fetching lines by plant:", error);
    res.status(500).send({
      message: "Error fetching lines by plant",
      error: error.message,
    });
  }
};