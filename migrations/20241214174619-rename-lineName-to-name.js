"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Rename the column 'lineName' to 'name' in the Lines table
    await queryInterface.renameColumn("Lines", "lineName", "name");
  },

  down: async (queryInterface, Sequelize) => {
    // Revert the column name change
    await queryInterface.renameColumn("Lines", "name", "lineName");
  },
};
