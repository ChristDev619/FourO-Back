'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Drop aggregate tables in reverse dependency order
    await queryInterface.dropTable('TagMonthlyAggregates');
    await queryInterface.dropTable('TagWeeklyAggregates');
    await queryInterface.dropTable('TagDailyAggregates');
    await queryInterface.dropTable('TagHourlyAggregates');
  },

  down: async (queryInterface, Sequelize) => {
    // Recreate tables if needed to rollback
    await queryInterface.createTable('TagHourlyAggregates', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      tagId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      hour: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      min_Value: {
        type: Sequelize.FLOAT
      },
      max_Value: {
        type: Sequelize.FLOAT
      },
      diffValue: {
        type: Sequelize.FLOAT
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    await queryInterface.createTable('TagDailyAggregates', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      tagId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      min_Value: {
        type: Sequelize.FLOAT
      },
      max_Value: {
        type: Sequelize.FLOAT
      },
      diffValue: {
        type: Sequelize.FLOAT
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    await queryInterface.createTable('TagWeeklyAggregates', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      tagId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      weekStart: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      weekEnd: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      min_Value: {
        type: Sequelize.FLOAT
      },
      max_Value: {
        type: Sequelize.FLOAT
      },
      diffValue: {
        type: Sequelize.FLOAT
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    await queryInterface.createTable('TagMonthlyAggregates', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      tagId: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      monthStart: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      monthEnd: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      min_Value: {
        type: Sequelize.FLOAT
      },
      max_Value: {
        type: Sequelize.FLOAT
      },
      diffValue: {
        type: Sequelize.FLOAT
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
  }
}; 