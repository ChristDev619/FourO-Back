"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn("Programs", "startDate", {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });

        await queryInterface.addColumn("Programs", "endDate", {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn("Programs", "startDate");
        await queryInterface.removeColumn("Programs", "endDate");
    },
};
