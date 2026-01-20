/**
 * ========================================
 * PLANNING DASHBOARD CONTROLLER
 * ========================================
 * 
 * Handles HTTP requests for Planning Dashboard analytics.
 * Provides computed KPIs without modifying any Planning data.
 * 
 * Endpoints:
 * - GET /planning-dashboard/all - Get KPIs for all recipes
 * - GET /planning-dashboard/:recipeId - Get KPIs for specific recipe
 * - GET /planning-dashboard/recipes - Get list of available recipes
 * 
 * @module controllers/planningDashboard.controller
 */

const planningService = require('../services/planning.service');
const logger = require('../utils/logger');

/**
 * ========================================
 * GET ALL KPIS FOR ALL RECIPES
 * ========================================
 * 
 * GET /planning-dashboard/all
 * 
 * Returns computed KPIs for all recipes across all years.
 * Used for dashboard overview and Excel export.
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
exports.getAllKPIs = async (req, res) => {
  try {
    logger.info('Fetching Planning Dashboard KPIs for all recipes');

    // 1. Fetch all planning data sources in parallel
    const planningData = await planningService.fetchAllPlanningData();

    // 2. Validate required data
    if (!planningData.demandForecast) {
      return res.status(404).json({
        success: false,
        message: 'No active Demand Forecast found. Please create one first.',
      });
    }

    // 3. Get all recipes from planning data
    const recipes = planningService.getAllRecipes(planningData);

    if (recipes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No recipes found in Demand Forecast.',
      });
    }

    // 4. Calculate Water Total KPIs (from Demand Forecast with packageTypeId = 1)
    let waterTotal = null;
    try {
      waterTotal = await planningService.calculateWaterTotalKPIs(planningData);
      logger.info(`Successfully calculated Water Total KPIs (${waterTotal.recipeCount} water recipes with packageTypeId = 1)`);
    } catch (error) {
      logger.warn('Could not calculate Water Total KPIs:', error.message);
      // Continue even if water total fails
    }

    // 5. Calculate KPIs for each recipe
    const results = recipes.map(recipe => {
      try {
        const kpis = planningService.calculateKPIsForRecipe(recipe.recipeId, planningData);
        
        return {
          recipeId: recipe.recipeId,
          recipeName: recipe.recipeName,
          category: recipe.category,
          kpis,
        };
      } catch (error) {
        logger.error(`Error calculating KPIs for recipe ${recipe.recipeId}:`, error);
        return {
          recipeId: recipe.recipeId,
          recipeName: recipe.recipeName,
          category: recipe.category,
          kpis: {},
          error: error.message,
        };
      }
    });

    // 6. Get years metadata
    const years = planningData.demandForecast.forecastData.years || [];

    logger.info(`Successfully calculated KPIs for ${results.length} recipes`);

    res.status(200).json({
      success: true,
      data: {
        waterTotal, // Water Total aggregated KPIs
        recipes: results,
        years: years.map(y => ({
          id: y.id,
          year: y.year,
          label: y.label,
          isCurrent: y.isCurrent || false,
        })),
        summary: {
          totalRecipes: results.length,
          categories: [...new Set(recipes.map(r => r.category))],
          hasWaterTotal: waterTotal !== null,
        },
      },
    });
  } catch (error) {
    logger.error('Error in getAllKPIs:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate Planning Dashboard KPIs',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * ========================================
 * GET KPIS FOR SPECIFIC RECIPE
 * ========================================
 * 
 * GET /planning-dashboard/:recipeId
 * 
 * Returns computed KPIs for a single recipe across all years.
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
exports.getKPIsByRecipe = async (req, res) => {
  try {
    const { recipeId } = req.params;

    // 1. Validate input
    if (!recipeId) {
      return res.status(400).json({
        success: false,
        message: 'Recipe ID is required',
      });
    }

    const parsedRecipeId = parseInt(recipeId, 10);
    if (isNaN(parsedRecipeId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Recipe ID format',
      });
    }

    logger.info(`Fetching Planning Dashboard KPIs for recipe: ${recipeId}`);

    // 2. Fetch all planning data sources
    const planningData = await planningService.fetchAllPlanningData();

    // 3. Validate required data
    if (!planningData.demandForecast) {
      return res.status(404).json({
        success: false,
        message: 'No active Demand Forecast found',
      });
    }

    // 4. Find recipe metadata
    const recipes = planningService.getAllRecipes(planningData);
    const recipe = recipes.find(r => r.recipeId === parsedRecipeId);

    if (!recipe) {
      return res.status(404).json({
        success: false,
        message: `Recipe with ID ${recipeId} not found in Demand Forecast`,
      });
    }

    // 5. Calculate KPIs
    const kpis = planningService.calculateKPIsForRecipe(parsedRecipeId, planningData);

    // 6. Get years metadata
    const years = planningData.demandForecast.forecastData.years || [];

    logger.info(`Successfully calculated KPIs for recipe ${recipeId}`);

    res.status(200).json({
      success: true,
      data: {
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        category: recipe.category,
        kpis,
        years: years.map(y => ({
          id: y.id,
          year: y.year,
          label: y.label,
          isCurrent: y.isCurrent || false,
        })),
      },
    });
  } catch (error) {
    logger.error('Error in getKPIsByRecipe:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate KPIs for recipe',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * ========================================
 * GET AVAILABLE RECIPES
 * ========================================
 * 
 * GET /planning-dashboard/recipes
 * 
 * Returns list of all recipes available in Planning data.
 * Used for dropdown filters in frontend.
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
exports.getAvailableRecipes = async (req, res) => {
  try {
    logger.info('Fetching available recipes for Planning Dashboard');

    // 1. Fetch all planning data
    const planningData = await planningService.fetchAllPlanningData();

    // 2. Validate demand forecast exists
    if (!planningData.demandForecast) {
      return res.status(404).json({
        success: false,
        message: 'No active Demand Forecast found',
      });
    }

    // 3. Get all recipes
    const recipes = planningService.getAllRecipes(planningData);

    if (recipes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No recipes found in Planning data',
      });
    }

    // 4. Group by category
    const categorizedRecipes = recipes.reduce((acc, recipe) => {
      const category = recipe.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
      });
      return acc;
    }, {});

    logger.info(`Found ${recipes.length} recipes in ${Object.keys(categorizedRecipes).length} categories`);

    res.status(200).json({
      success: true,
      data: {
        recipes,
        categorizedRecipes,
        summary: {
          totalRecipes: recipes.length,
          categories: Object.keys(categorizedRecipes),
        },
      },
    });
  } catch (error) {
    logger.error('Error in getAvailableRecipes:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch available recipes',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * ========================================
 * GET KPIS BY CATEGORY
 * ========================================
 * 
 * GET /planning-dashboard/category/:categoryName
 * 
 * Returns aggregated KPIs for all recipes in a category.
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
exports.getKPIsByCategory = async (req, res) => {
  try {
    const { categoryName } = req.params;

    // 1. Validate input
    if (!categoryName) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required',
      });
    }

    logger.info(`Fetching Planning Dashboard KPIs for category: ${categoryName}`);

    // 2. Fetch all planning data
    const planningData = await planningService.fetchAllPlanningData();

    // 3. Validate required data
    if (!planningData.demandForecast) {
      return res.status(404).json({
        success: false,
        message: 'No active Demand Forecast found',
      });
    }

    // 4. Get recipes in this category
    const allRecipes = planningService.getAllRecipes(planningData);
    const categoryRecipes = allRecipes.filter(r => 
      r.category.toLowerCase() === categoryName.toLowerCase()
    );

    if (categoryRecipes.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No recipes found in category: ${categoryName}`,
      });
    }

    // 5. Calculate KPIs for each recipe in category
    const results = categoryRecipes.map(recipe => {
      try {
        const kpis = planningService.calculateKPIsForRecipe(recipe.recipeId, planningData);
        
        return {
          recipeId: recipe.recipeId,
          recipeName: recipe.recipeName,
          kpis,
        };
      } catch (error) {
        logger.error(`Error calculating KPIs for recipe ${recipe.recipeId}:`, error);
        return {
          recipeId: recipe.recipeId,
          recipeName: recipe.recipeName,
          kpis: {},
          error: error.message,
        };
      }
    });

    // 6. Calculate category totals (sum across all recipes)
    const years = planningData.demandForecast.forecastData.years || [];
    const categoryTotals = {};

    years.forEach(year => {
      const yearId = year.id;
      
      categoryTotals[yearId] = {
        year: year.year,
        yearLabel: year.label,
        annualVolume: results.reduce((sum, r) => sum + (r.kpis[yearId]?.annualVolume || 0), 0),
        annualCapacityAct: results.reduce((sum, r) => sum + (r.kpis[yearId]?.annualCapacityAct || 0), 0),
        annualCapacityStd: results.reduce((sum, r) => sum + (r.kpis[yearId]?.annualCapacityStd || 0), 0),
        peakVolume: Math.max(...results.map(r => r.kpis[yearId]?.peakVolume || 0)),
        peakCapacityAct: Math.max(...results.map(r => r.kpis[yearId]?.peakCapacityAct || 0)),
        peakCapacityStd: Math.max(...results.map(r => r.kpis[yearId]?.peakCapacityStd || 0)),
      };
      
      // Calculate utilizations for totals
      categoryTotals[yearId].annualUtilizationAct = categoryTotals[yearId].annualCapacityAct > 0
        ? (categoryTotals[yearId].annualVolume / categoryTotals[yearId].annualCapacityAct) * 100
        : 0;
      
      categoryTotals[yearId].annualUtilizationStd = categoryTotals[yearId].annualCapacityStd > 0
        ? (categoryTotals[yearId].annualVolume / categoryTotals[yearId].annualCapacityStd) * 100
        : 0;
      
      categoryTotals[yearId].peakUtilizationAct = categoryTotals[yearId].peakCapacityAct > 0
        ? (categoryTotals[yearId].peakVolume / categoryTotals[yearId].peakCapacityAct) * 100
        : 0;
      
      categoryTotals[yearId].peakUtilizationStd = categoryTotals[yearId].peakCapacityStd > 0
        ? (categoryTotals[yearId].peakVolume / categoryTotals[yearId].peakCapacityStd) * 100
        : 0;
    });

    logger.info(`Successfully calculated KPIs for category ${categoryName} (${results.length} recipes)`);

    res.status(200).json({
      success: true,
      data: {
        category: categoryName,
        recipes: results,
        categoryTotals,
        years: years.map(y => ({
          id: y.id,
          year: y.year,
          label: y.label,
          isCurrent: y.isCurrent || false,
        })),
        summary: {
          totalRecipes: results.length,
        },
      },
    });
  } catch (error) {
    logger.error('Error in getKPIsByCategory:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate KPIs for category',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

/**
 * ========================================
 * HEALTH CHECK
 * ========================================
 * 
 * GET /planning-dashboard/health
 * 
 * Check if all required Planning data sources are available.
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
exports.healthCheck = async (req, res) => {
  try {
    const planningData = await planningService.fetchAllPlanningData();

    const status = {
      demandForecast: !!planningData.demandForecast,
      seasonalityData: !!planningData.seasonalityData,
      monthlyForecast: !!planningData.monthlyForecast,
      lineData: !!planningData.lineData,
      packageSummary: !!planningData.packageSummary,
    };

    const allHealthy = Object.values(status).every(v => v === true);

    res.status(allHealthy ? 200 : 503).json({
      success: allHealthy,
      status,
      message: allHealthy 
        ? 'All Planning data sources are available' 
        : 'Some Planning data sources are missing',
    });
  } catch (error) {
    logger.error('Error in healthCheck:', error);
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message,
    });
  }
};

