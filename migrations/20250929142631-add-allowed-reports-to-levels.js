'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Levels', 'allowedReports', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: 'Stores array of report IDs that this access level can access'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Levels', 'allowedReports');
  }
};
