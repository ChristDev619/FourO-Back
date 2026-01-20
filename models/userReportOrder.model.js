"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class UserReportOrder extends Model {
        static associate(models) {
            UserReportOrder.belongsTo(models.Report, {
                foreignKey: "reportId",
                as: "report",
            });

            UserReportOrder.belongsTo(models.User, {
                foreignKey: "userId",
                as: "user",
            });
        }
    }

    UserReportOrder.init(
        {
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            reportId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            sortOrder: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
        },
        {
            sequelize,
            modelName: "UserReportOrder",
            tableName: "UserReportOrders",
            timestamps: true,
        }
    );

    return UserReportOrder;
};
