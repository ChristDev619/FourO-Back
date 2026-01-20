'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Levels', 'allowedDashboards', {
      type: Sequelize.JSON,
      allowNull: true,
      comment: 'Stores array of dashboard IDs that this access level can access'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Levels', 'allowedDashboards');
  }
};
