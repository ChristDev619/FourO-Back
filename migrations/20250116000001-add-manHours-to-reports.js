"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("Reports", "manHours", {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 0,
            comment: "Man hours (user input for report calculations)",
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("Reports", "manHours");
    },
};

