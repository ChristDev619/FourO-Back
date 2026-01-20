"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable("Settings", {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                defaultValue: 1,
                allowNull: false,
            },
            costPerManHour: {
                type: Sequelize.DECIMAL(10, 2),
                allowNull: false,
                defaultValue: 0,
                comment: "Global cost per man hour in currency units (applies to all reports)",
            },
            createdAt: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            updatedAt: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
            },
        });

        // Insert initial row with id = 1
        await queryInterface.bulkInsert("Settings", [
            {
                id: 1,
                costPerManHour: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ]);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable("Settings");
    },
};

