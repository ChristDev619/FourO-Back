"use strict";

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn("Jobs", "programId", {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: {
                model: "Programs",
                key: "id",
            },
            onUpdate: "CASCADE",
            onDelete: "SET NULL",
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn("Jobs", "programId");
    },
};
