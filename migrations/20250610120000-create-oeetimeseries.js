'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('OEETimeSeries', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      jobId: { type: Sequelize.INTEGER, allowNull: false },
      minute: { type: Sequelize.INTEGER, allowNull: false },
      timestamp: { type: Sequelize.DATE, allowNull: false },
      oee: { type: Sequelize.FLOAT, allowNull: false },
      availability: { type: Sequelize.FLOAT, allowNull: false },
      performance: { type: Sequelize.FLOAT, allowNull: false },
      quality: { type: Sequelize.FLOAT, allowNull: false },
      // Add more fields if you want to store more metrics per minute
    });
    await queryInterface.addIndex('OEETimeSeries', ['jobId', 'minute']);
    // Optionally, add this if you want to query by timestamp:
    // await queryInterface.addIndex('OEETimeSeries', ['jobId', 'timestamp']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('OEETimeSeries');
  }
};