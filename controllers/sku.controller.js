const db = require("../dbInit");
const { Sku } = db;

exports.createSku = async (req, res) => {
  try {
    const [sku, created] = await Sku.findOrCreate({
      where: { name: req.body.name }, // Search by name
      defaults: req.body, // Create only if not found
    });

    if (!created) {
      return res.status(400).send({ message: "exists" });
    }

    res.status(201).send(sku);
  } catch (error) {
    res.status(500).send({ message: "An error occurred", error });
  }
};

exports.getAllSkus = async (req, res) => {
  try {
    const skus = await Sku.findAll();
    res.status(200).send(skus);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getSkuById = async (req, res) => {
  try {
    const sku = await Sku.findByPk(req.params.id);
    if (sku) {
      res.status(200).send(sku);
    } else {
      res.status(404).send({ message: "SKU not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateSku = async (req, res) => {
  try {
    const { name } = req.body;
    const skuId = req.params.id;

    // Check if an SKU with the same name already exists (excluding the current one)
    const existingSku = await Sku.findOne({ 
      where: { name, id: { [db.Sequelize.Op.ne]: skuId } } 
    });

    if (existingSku) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate name
    }

    // Proceed with the update
    const [updated] = await Sku.update(req.body, {
      where: { id: skuId },
    });

    if (updated) {
      res.status(200).send({ message: "SKU updated successfully." });
    } else {
      res.status(404).send({ message: "SKU not found." });
    }
  } catch (error) {
    console.error("Error updating SKU:", error);
    res.status(500).send({ message: "An error occurred while updating the SKU." });
  }
};

exports.deleteSku = async (req, res) => {
  try {
    const sku = await Sku.destroy({
      where: { id: req.params.id },
    });
    if (sku == 1) {
      res.status(200).send({ message: "SKU deleted successfully." });
    } else {
      res.status(404).send({ message: "SKU not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getSkuByName = async (req, res) => {
  try {
    const sku = await Sku.findOne({ where: { name: req.params.name } });
    if (sku) {
      res.status(200).send(sku);
    } else {
      res.status(404).send({ message: "SKU not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllSkusPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { count, rows } = await Sku.findAndCountAll({
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
    console.log(error);
    
    res.status(500).send(error);
  }
};
