'use strict';

/**
 * Migration: Create PackageTypes table
 * This enables master data management for package types used in recipes and demand forecasting
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PackageTypes', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Package type name (e.g., 0.5L PET Water)',
      },
      size: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Package size (e.g., 0.5L, 0.33L, 1.5L)',
      },
      material: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Package material (e.g., PET, Glass, Aluminum)',
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Detailed description of the package type',
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Indicates if the package type is active',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    // Add index on name for faster lookups and uniqueness
    await queryInterface.addIndex('PackageTypes', ['name'], {
      name: 'idx_package_types_name',
      unique: true,
    });

    // Add index on isActive for filtering
    await queryInterface.addIndex('PackageTypes', ['isActive'], {
      name: 'idx_package_types_is_active',
    });

    console.log('✓ PackageTypes table created successfully');
    console.log('✓ Indexes added for name and isActive');
  },

  down: async (queryInterface, Sequelize) => {
    // Remove indexes
    await queryInterface.removeIndex('PackageTypes', 'idx_package_types_name');
    await queryInterface.removeIndex('PackageTypes', 'idx_package_types_is_active');

    // Drop table
    await queryInterface.dropTable('PackageTypes');

    console.log('✓ PackageTypes table dropped');
  }
};

