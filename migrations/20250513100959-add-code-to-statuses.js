"use strict";

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("Statuses", "code", {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: -1, // Temporary default to avoid conflict
            unique: true,
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("Statuses", "code");
    },
};
