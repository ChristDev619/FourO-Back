'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('UserReportOrders', {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER,
            },
            userId: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'Users',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            reportId: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: 'Reports',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            sortOrder: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW'),
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('NOW'),
            },
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('UserReportOrders');
    },
};
