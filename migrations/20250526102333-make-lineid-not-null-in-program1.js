'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.changeColumn('Programs', 'lineId', {
            type: Sequelize.INTEGER,
            allowNull: false,
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.changeColumn('Programs', 'lineId', {
            type: Sequelize.INTEGER,
            allowNull: true,
        });
    },
};