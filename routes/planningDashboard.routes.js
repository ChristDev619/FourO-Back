/**
 * ========================================
 * PLANNING DASHBOARD ROUTES
 * ========================================
 * 
 * API routes for Planning Dashboard analytics.
 * All endpoints are read-only (no modifications to Planning data).
 * 
 * @module routes/planningDashboard.routes
 */

const express = require('express');
const router = express.Router();
const planningDashboardController = require('../controllers/planningDashboard.controller');

/**
 * @route   GET /api/planning-dashboard/health
 * @desc    Check if all Planning data sources are available
 * @access  Public
 */
router.get('/health', planningDashboardController.healthCheck);

/**
 * @route   GET /api/planning-dashboard/recipes
 * @desc    Get list of all available recipes
 * @access  Public
 */
router.get('/recipes', planningDashboardController.getAvailableRecipes);

/**
 * @route   GET /api/planning-dashboard/all
 * @desc    Get computed KPIs for all recipes
 * @access  Public
 */
router.get('/all', planningDashboardController.getAllKPIs);

/**
 * @route   GET /api/planning-dashboard/category/:categoryName
 * @desc    Get aggregated KPIs for a specific category
 * @access  Public
 */
router.get('/category/:categoryName', planningDashboardController.getKPIsByCategory);

/**
 * @route   GET /api/planning-dashboard/:recipeId
 * @desc    Get computed KPIs for a specific recipe
 * @access  Public
 */
router.get('/:recipeId', planningDashboardController.getKPIsByRecipe);

module.exports = router;

