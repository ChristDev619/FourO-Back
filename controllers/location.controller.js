const db = require("../dbInit");
const { Location } = db;

exports.createLocation = async (req, res) => {
  try {
    const locationName = req.body.name.trim().toLowerCase(); // Normalize input

    // Check if the location name already exists (case-insensitive)
    const existingLocation = await Location.findOne({
      where: db.Sequelize.where(
        db.Sequelize.fn("LOWER", db.Sequelize.col("name")),
        locationName
      ),
    });

    if (existingLocation) {
      return res.status(400).send({ message: "exists" });
    }

    // Create the new location if it doesn't exist
    const location = await Location.create(req.body);
    res.status(201).send(location);
  } catch (error) {
    console.log(error);
    res.status(500).send({ message: "An error occurred while creating the location." });
  }
};


exports.getAllLocations = async (req, res) => {
  try {
    const locations = await Location.findAll({
      include: ["children"], // If you want to include child locations in the list
    });
    res.status(200).send(locations);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getLocationById = async (req, res) => {
  try {
    const location = await Location.findByPk(req.params.id, {
      include: ["children"], // If you want to include child locations
    });
    if (location) {
      res.status(200).send(location);
    } else {
      res.status(404).send({ message: "Location not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const locationId = req.params.id;
    const locationName = req.body.name.trim().toLowerCase(); // Normalize input

    // Check if another location with the same name already exists (excluding the current one)
    const existingLocation = await Location.findOne({
      where: {
        id: { [db.Sequelize.Op.ne]: locationId }, // Exclude the current location
        [db.Sequelize.Op.and]: db.Sequelize.where(
          db.Sequelize.fn("LOWER", db.Sequelize.col("name")),
          locationName
        ),
      },
    });

    if (existingLocation) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate entry
    }

    // Proceed with update
    const [updated] = await Location.update(req.body, { where: { id: locationId } });

    if (updated) {
      res.status(200).send({ message: "Location updated successfully." });
    } else {
      res.status(404).send({ message: "Location not found." });
    }
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).send({ message: "An error occurred while updating the location." });
  }
};


exports.deleteLocation = async (req, res) => {
  try {
    const location = await Location.findOne({
      where: { id: req.params.id },
    });

    if (!location) {
      return res.status(404).send({ message: "Location not found." });
    }

    await Location.destroy({
      where: { id: req.params.id },
    });

    res.status(200).send({ message: "Location deleted successfully." });
  } catch (error) {
    console.error("Error deleting location:", error);
    res.status(500).send({ message: "An error occurred while deleting the location." });
  }
};


exports.getChildrenByParentId = async (req, res) => {
  try {
    const { parentLocationId } = req.params;
    const children = await Location.findAll({
      where: { parentLocationId },
      include: ["children"],
    });
    res.status(200).send({data:children});
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getLocationsWithPagination = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10; // number of records per page
    const offset = parseInt(req.query.page) || 0; // start index for the current page

    const locations = await Location.findAndCountAll({
      limit,
      offset: offset * limit,
      include: ["children"],
      distinct: true,
      order: [['createdAt', 'DESC']],
    });
    res.status(200).send({
      total: locations.count,
      pages: Math.ceil(locations.count / limit),
      data: locations.rows,
    });
  } catch (error) {
    res.status(500).send(error);
  }
};

const buildTree = (locations, parentId = null) => {
  return locations
    .filter((location) => location.parentLocationId === parentId)
    .map((location) => ({
      ...location.dataValues,
      children: buildTree(locations, location.id),
    }));
};

exports.getLocationsAsTree = async (req, res) => {
  try {
    const allLocations = await Location.findAll();
    const tree = buildTree(allLocations);
    res.status(200).send(tree);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getRootLocations = async (req, res) => {
  try {
    const rootLocations = await Location.findAll({
      where: { parentLocationId: null }, // Only fetch locations with no parent
      include: ["children"], // Include this to check if each root location has children
    });
    res.status(200).send(rootLocations);
  } catch (error) {
    res.status(500).send(error);
  }
};
