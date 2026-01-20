'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('Programs', 'lineId', {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: {
                model: 'Lines',
                key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'RESTRICT',
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('Programs', 'lineId');
    },
};