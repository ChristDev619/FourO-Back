"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("TariffTypes", "costPerManHour");
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("TariffTypes", "costPerManHour", {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 0,
            comment: "Cost of one man hour in currency units",
        });
    },
};

