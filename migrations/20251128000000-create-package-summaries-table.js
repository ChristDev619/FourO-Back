'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('PackageSummaries', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'Package Summary',
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      summaryData: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: JSON.stringify({
          years: [],
          packagesByYear: {},
        }),
        comment: 'Stores all package summary data including years, packages, monthly data, and calculations',
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Add index on isActive for faster queries
    await queryInterface.addIndex('PackageSummaries', ['isActive'], {
      name: 'idx_package_summaries_is_active',
    });

    // Add index on userId
    await queryInterface.addIndex('PackageSummaries', ['userId'], {
      name: 'idx_package_summaries_user_id',
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove indexes first
    await queryInterface.removeIndex('PackageSummaries', 'idx_package_summaries_is_active');
    await queryInterface.removeIndex('PackageSummaries', 'idx_package_summaries_user_id');

    // Drop table
    await queryInterface.dropTable('PackageSummaries');
  },
};

