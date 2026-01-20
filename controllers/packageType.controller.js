const db = require("../dbInit");
const { PackageType } = db;

// Create a new package type
exports.createPackageType = async (req, res) => {
  const { name, description, isActive } = req.body;

  try {
    // Check if a package type with the same name already exists (case-insensitive)
    const existingPackageType = await PackageType.findOne({
      where: db.Sequelize.where(
        db.Sequelize.fn("LOWER", db.Sequelize.col("name")),
        name.trim().toLowerCase()
      ),
    });

    if (existingPackageType) {
      return res.status(400).send({ message: "Package type with this name already exists" });
    }

    const packageType = await PackageType.create({
      name,
      description,
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).send(packageType);
  } catch (error) {
    console.error("Error creating package type:", error);
    res.status(500).send({ message: "An error occurred while creating the package type." });
  }
};

// Get all package types
exports.getAllPackageTypes = async (req, res) => {
  try {
    const packageTypes = await PackageType.findAll({
      order: [["name", "ASC"]],
    });
    res.status(200).send(packageTypes);
  } catch (error) {
    console.error("Error fetching package types:", error);
    res.status(500).send(error);
  }
};

// Get active package types only
exports.getActivePackageTypes = async (req, res) => {
  try {
    const packageTypes = await PackageType.findAll({
      where: { isActive: true },
      order: [["name", "ASC"]],
    });
    res.status(200).send(packageTypes);
  } catch (error) {
    console.error("Error fetching active package types:", error);
    res.status(500).send(error);
  }
};

// Get package type by ID
exports.getPackageTypeById = async (req, res) => {
  try {
    const packageType = await PackageType.findByPk(req.params.id, {
      include: [
        {
          model: db.Recipie,
          as: "recipes",
        },
      ],
    });
    
    if (packageType) {
      res.status(200).send(packageType);
    } else {
      res.status(404).send({ message: "Package type not found." });
    }
  } catch (error) {
    console.error("Error fetching package type:", error);
    res.status(500).send(error);
  }
};

// Update package type
exports.updatePackageType = async (req, res) => {
  const { name, description, isActive } = req.body;
  const { id } = req.params;

  try {
    // Check if another package type with the same name already exists (excluding current one)
    const existingPackageType = await PackageType.findOne({
      where: {
        id: { [db.Sequelize.Op.ne]: id },
        [db.Sequelize.Op.and]: db.Sequelize.where(
          db.Sequelize.fn("LOWER", db.Sequelize.col("name")),
          name.trim().toLowerCase()
        ),
      },
    });

    if (existingPackageType) {
      return res.status(400).send({ message: "Package type with this name already exists" });
    }

    const packageType = await PackageType.findByPk(id);

    if (!packageType) {
      return res.status(404).send({ message: "Package type not found." });
    }

    await packageType.update({ name, description, isActive });

    res.status(200).send(packageType);
  } catch (error) {
    console.error("Error updating package type:", error);
    res.status(500).send(error);
  }
};

// Delete package type
exports.deletePackageType = async (req, res) => {
  try {
    // Check if any recipes are using this package type
    const recipesCount = await db.Recipie.count({
      where: { packageTypeId: req.params.id },
    });

    if (recipesCount > 0) {
      return res.status(400).send({ 
        message: `Cannot delete package type. ${recipesCount} recipe(s) are using it.` 
      });
    }

    const deleted = await PackageType.destroy({
      where: { id: req.params.id },
    });
    
    if (deleted === 1) {
      res.status(200).send({ message: "Package type deleted successfully." });
    } else {
      res.status(404).send({ message: "Package type not found." });
    }
  } catch (error) {
    console.error("Error deleting package type:", error);
    res.status(500).send(error);
  }
};

// Get paginated package types
exports.getAllPackageTypesPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    
    const { count, rows } = await PackageType.findAndCountAll({
      limit,
      offset: page * limit,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: db.Recipie,
          as: "recipes",
          attributes: ["id", "name"],
        },
      ],
    });
    
    res.status(200).send({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching paginated package types:", error);
    res.status(500).send(error);
  }
};

