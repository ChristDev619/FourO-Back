"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("Reports", "volumeOfDiesel", {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 0,
            comment: "Volume of diesel in liters (user input for EMS calculations)",
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("Reports", "volumeOfDiesel");
    },
};

