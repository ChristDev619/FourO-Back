const db = require("../dbInit");
const { Level ,Op } = db;

exports.createLevel = async (req, res) => {
  try {
    const existingLevel = await Level.findOne({
      where: { name: req.body.name },
    });
    if (existingLevel) {
      return res.status(400).send({ message: "exists" });
    }

    const level = await Level.create(req.body);
    res.status(201).send(level);
  } catch (error) {
    console.log(error);
    res
      .status(500)
      .send({ message: "Error creating level", error: error.message });
  }
};

exports.getAllLevels = async (req, res) => {
  try {
    const levels = await Level.findAll();
    res.status(200).send(levels);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getLevelById = async (req, res) => {
  try {
    const level = await Level.findByPk(req.params.id);
    if (level) {
      res.status(200).send(level);
    } else {
      res.status(404).send({ message: "Level not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateLevel = async (req, res) => {
  try {
    const { name } = req.body;
    const levelId = req.params.id;

    // Check if the level exists
    const level = await Level.findByPk(levelId);
    if (!level) {
      return res.status(404).send({ message: "Level not found." });
    }

    // Check if another level with the same name already exists (excluding the current level)
    const existingLevel = await Level.findOne({
      where: {
        id: { [db.Sequelize.Op.ne]: levelId }, // Exclude the current level
        name, // Check for duplicate name
      },
    });

    if (existingLevel) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Proceed with update
    await level.update(req.body);

    res.status(200).send({ message: "Level updated successfully." });
  } catch (error) {
    console.error("Error updating level:", error);
    res.status(500).send({ message: "An error occurred while updating the level." });
  }
};


exports.deleteLevel = async (req, res) => {
  try {
    const deleted = await Level.destroy({
      where: { id: req.params.id },
    });
    if (deleted === 1) {
      res.status(200).send({ message: "Level deleted successfully." });
    } else {
      res.status(404).send({ message: "Level not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllLevelsPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;

    const { count, rows } = await Level.findAndCountAll({
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
    console.error("Pagination Error:", error);
    res.status(500).send(error);
  }
};
