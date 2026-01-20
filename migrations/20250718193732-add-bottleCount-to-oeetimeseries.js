'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('OEETimeSeries', 'bottleCount', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0, // Use 0 or another sensible default for existing rows
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('OEETimeSeries', 'bottleCount');
  }
};