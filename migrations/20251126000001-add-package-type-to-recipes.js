'use strict';

/**
 * Migration: Add packageTypeId to Recipes table
 * Links recipes to package types (optional relationship)
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add packageTypeId column to Recipes table
    await queryInterface.addColumn('Recipes', 'packageTypeId', {
      type: Sequelize.INTEGER,
      allowNull: true, // Optional - recipes can exist without package type
      references: {
        model: 'PackageTypes',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL', // If package type is deleted, set recipe's packageTypeId to NULL
      comment: 'Foreign key to PackageTypes table (optional)',
    });

    // Add index for faster joins and filtering
    await queryInterface.addIndex('Recipes', ['packageTypeId'], {
      name: 'idx_recipes_package_type_id',
    });

    console.log('✓ packageTypeId column added to Recipes table');
    console.log('✓ Foreign key constraint and index created');
    console.log('✓ Existing recipes will have packageTypeId = NULL (backward compatible)');
  },

  down: async (queryInterface, Sequelize) => {
    // Remove index
    await queryInterface.removeIndex('Recipes', 'idx_recipes_package_type_id');

    // Remove foreign key and column
    await queryInterface.removeColumn('Recipes', 'packageTypeId');

    console.log('✓ packageTypeId column removed from Recipes table');
  }
};

