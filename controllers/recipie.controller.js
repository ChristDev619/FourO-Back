const db = require("../dbInit");
const { Recipie, LineRecipie } = db;

exports.createRecipie = async (req, res) => {
  const { name, number, skuId, packageTypeId, lineData } = req.body;

  try {
    // Check if a recipe with the same name already exists (case-insensitive)
    const existingRecipie = await Recipie.findOne({
      where: db.Sequelize.where(
        db.Sequelize.fn("LOWER", db.Sequelize.col("name")),
        name.trim().toLowerCase()
      ),
    });

    if (existingRecipie) {
      return res.status(400).send({ message: "exists" });
    }

    // Create a new recipe
    const recipie = await Recipie.create({
      name,
      number,
      skuId,
      packageTypeId: packageTypeId || null,
    });

    // Set associated lines with designSpeedId
    if (lineData && lineData.length > 0) {
      const lineRecipieData = lineData.map((line) => ({
        lineId: line.lineId,
        recipieId: recipie.id,
        designSpeedId: line.designSpeedId, // Adding designSpeedId for each line
      }));

      await LineRecipie.bulkCreate(lineRecipieData);
    }

    res.status(201).send(recipie);
  } catch (error) {
    console.error("Error creating recipie: ", error);
    res.status(500).send({ message: "An error occurred while creating the recipe." });
  }
};

exports.getAllRecipes = async (req, res) => {
  try {
    const recipes = await Recipie.findAll({
      include: [
        {
          model: db.Sku,
          as: "sku",
        },
        {
          model: db.PackageType,
          as: "packageType",
        },
      ],
    });
    res.status(200).send(recipes);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getRecipieById = async (req, res) => {
  try {
    const recipie = await Recipie.findByPk(req.params.id, {
      include: [
        {
          model: db.Sku,
          as: "sku",
        },
        {
          model: db.PackageType,
          as: "packageType",
        },
      ],
    });
    if (recipie) {
      res.status(200).send(recipie);
    } else {
      res.status(404).send({ message: "Recipie not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateRecipie = async (req, res) => {
  const { name, number, skuId, packageTypeId, lineData } = req.body; // Assuming lines is an array of objects with lineId and designSpeedId
  const { id } = req.params;

  try {
        // Check if another recipe with the same name already exists (excluding the current one)
        const existingRecipie = await Recipie.findOne({
            where: {
                id: { [db.Sequelize.Op.ne]: id }, // Exclude the current recipe
                [db.Sequelize.Op.and]: db.Sequelize.where(
                    db.Sequelize.fn("LOWER", db.Sequelize.col("name")),
                    name.trim().toLowerCase()
                ),
            },
        });

        if (existingRecipie) {
            return res.status(400).send({ message: "exists" });
        }

    const recipie = await Recipie.findByPk(id);

    if (!recipie) {
      return res.status(404).send({ message: "Recipie not found." });
    }

    await recipie.update({ name, number, skuId, packageTypeId: packageTypeId || null });

    // Remove existing LineRecipie associations
    await LineRecipie.destroy({ where: { recipieId: recipie.id } });

    // Create new LineRecipie associations with designSpeedId
    if (lineData && lineData.length > 0) {
      const lineRecipieData = lineData.map((line) => ({
        lineId: line.lineId,
        recipieId: recipie.id,
        designSpeedId: line.designSpeedId, // Adding designSpeedId for each line
      }));

      await LineRecipie.bulkCreate(lineRecipieData); // Re-create all line-recipe associations
    }

    res.status(200).send(recipie);
  } catch (error) {
    console.error("Error updating recipie: ", error);
    res.status(500).send(error);
  }
};

exports.deleteRecipie = async (req, res) => {
  try {
    const recipie = await Recipie.destroy({
      where: { id: req.params.id },
    });
    if (recipie == 1) {
      res.status(200).send({ message: "Recipie deleted successfully." });
    } else {
      res.status(404).send({ message: "Recipie not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getRecipieBySkuId = async (req, res) => {
  try {
    const recipes = await Recipie.findAll({
      where: { skuId: req.params.skuId },
    });
    res.status(200).send(recipes);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllRecipesPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { count, rows } = await Recipie.findAndCountAll({
      limit,
      offset: page * limit,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: db.Line,
          as: "lines", // Make sure this matches your association alias in the Recipie model
        },
        {
          model: db.Sku,
          as: "sku", // Make sure this matches your association alias in the Recipie model
        },
        {
          model: db.PackageType,
          as: "packageType", // Include PackageType so it's available in the Update dialog
        },
      ],
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

exports.getLineRecipies = async (req, res) => {
  try {
    const recipes = await LineRecipie.findAll({
      where: { recipieId: req.params.id },
      include: [
        { model: db.DesignSpeed, as: "designSpeed" },
        { model: db.Line, as: "line" },
      ],
    });
    res.status(200).send(recipes);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getDesignSpeedForLineRecipe = async (req, res) => {
  const { lineId, recipeId } = req.params;
  
  try {
    const lineRecipe = await LineRecipie.findOne({
      where: { lineId, recipieId: recipeId }, // Database column is 'recipieId' not 'recipeId'
      include: [{ model: db.DesignSpeed, as: "designSpeed" }]
    });
    
    if (lineRecipe && lineRecipe.designSpeed) {
      res.status(200).send({
        designSpeed: lineRecipe.designSpeed.value,
        designSpeedId: lineRecipe.designSpeedId
      });
    } else {
      res.status(404).send({ 
        message: "Design speed not found for this line-recipe combination",
        designSpeed: 0 
      });
    }
  } catch (error) {
    console.error("Error fetching design speed for line-recipe:", error);
    res.status(500).send(error);
  }
};

exports.getRecipesByLine = async (req, res) => {
  const { lineId } = req.params;
  
  try {
    const lineRecipes = await LineRecipie.findAll({
      where: { lineId },
      include: [
        { 
          model: db.Recipie, 
          as: "recipie",
          include: [
            { model: db.Sku, as: "sku" },
            { model: db.PackageType, as: "packageType" } // Include PackageType
          ]
        }
      ]
    });
    
    // Extract unique recipes from line-recipe relationships
    const recipes = lineRecipes
      .filter(lr => lr.recipie) // Filter out null recipes
      .map(lr => lr.recipie);
    
    res.status(200).send(recipes);
  } catch (error) {
    console.error("Error fetching recipes for line:", error);
    res.status(500).send(error);
  }
};