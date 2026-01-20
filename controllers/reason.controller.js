const db = require("../dbInit");
const { Reason } = db;

exports.createReason = async (req, res) => {
  try {
    // Check if a reason with the same name already exists
    const existingReason = await Reason.findOne({ where: { name: req.body.name } });

    if (existingReason) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // If it doesn't exist, create a new reason
    const reason = await Reason.create(req.body);
    res.status(201).send(reason);
  } catch (error) {
    res.status(500).send({ message: "An error occurred", error });
  }
};

exports.getAllReasons = async (req, res) => {
  try {
    const reasons = await Reason.findAll();
    res.status(200).send(reasons);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getReasonById = async (req, res) => {
  try {
    const reason = await Reason.findByPk(req.params.id);
    if (reason) {
      res.status(200).send(reason);
    } else {
      res.status(404).send({ message: "Reason not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateReason = async (req, res) => {
  try {
    const { name } = req.body;
    const reasonId = req.params.id;

    // Check if another reason with the same name already exists (excluding current reason)
    const existingReason = await Reason.findOne({
      where: {
        id: { [db.Sequelize.Op.ne]: reasonId }, // Exclude the current reason
        name, // Check for the same name
      },
    });

    if (existingReason) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Proceed with update
    const [updated] = await Reason.update(req.body, { where: { id: reasonId } });

    if (updated) {
      res.status(200).send({ message: "Reason updated successfully." });
    } else {
      res.status(404).send({ message: "Reason not found." });
    }
  } catch (error) {
    console.error("Error updating reason:", error);
    res.status(500).send({ message: "An error occurred while updating the reason." });
  }
};

exports.deleteReason = async (req, res) => {
  try {
    const reason = await Reason.destroy({
      where: { id: req.params.id },
    });
    if (reason == 1) {
      res.status(200).send({ message: "Reason deleted successfully." });
    } else {
      res.status(404).send({ message: "Reason not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getReasonByName = async (req, res) => {
  try {
    const reason = await Reason.findOne({ where: { name: req.params.name } });
    if (reason) {
      res.status(200).send(reason);
    } else {
      res.status(404).send({ message: "Reason not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllReasonsPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { count, rows } = await Reason.findAndCountAll({
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

exports.bulkInsertReasons = async (req, res) => {
  try {
    const reasons = req.body;

    if (!reasons || reasons.length === 0) {
      return res.status(400).json({ message: "No data to insert." });
    }

    // Extract names from incoming data
    const incomingNames = reasons.map((reason) => reason.name);

    // Find existing reasons in the database
    const existingReasons = await Reason.findAll({
      where: { name: incomingNames },
      attributes: ["name"], // Retrieve only names to compare
    });

    // Extract names that already exist
    const existingNames = existingReasons.map((reason) => reason.name);

    // Filter out the new reasons that are not in the existing list
    const newReasons = reasons.filter((reason) => !existingNames.includes(reason.name));

    if (newReasons.length > 0) {
      await Reason.bulkCreate(newReasons);
    }

    return res.status(201).json({
      message: "Reasons bulk insert successfully!",
      inserted: newReasons.map((r) => r.name), // Names of inserted records
      existing: existingNames, // Names of already existing records
    });
  } catch (error) {
    console.error("Error inserting reasons:", error);
    return res.status(500).json({
      message: "Failed to insert reasons",
      error: error.message,
    });
  }
};
