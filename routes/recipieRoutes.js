const express = require("express");
const router = express.Router();
const recipieController = require("../controllers/recipie.controller");

// Create a new recipie
router.post("/", recipieController.createRecipie);

// Retrieve all recipes
router.get("/", recipieController.getAllRecipes);

// Retrieve a single recipie by ID
router.get("/:id", recipieController.getRecipieById);

// Update a recipie by ID
router.patch("/:id", recipieController.updateRecipie);

// Delete a recipie by ID
router.delete("/:id", recipieController.deleteRecipie);

// Search recipes by SKU ID
router.get("/search/sku/:skuId", recipieController.getRecipieBySkuId);

// Retrieve all recipes paginated
router.get("/getAll/paginated", recipieController.getAllRecipesPaginated);
router.get("/getLineRecipies/by-recipie/:id", recipieController.getLineRecipies);

// Get design speed for specific line-recipe combination
router.get("/design-speed/:lineId/:recipeId", recipieController.getDesignSpeedForLineRecipe);

// Get recipes by line
router.get("/by-line/:lineId", recipieController.getRecipesByLine);

module.exports = router;
