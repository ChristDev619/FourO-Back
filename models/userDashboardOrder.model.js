"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class UserDashboardOrder extends Model {
    static associate(models) {
      UserDashboardOrder.belongsTo(models.Dashboard, {
        foreignKey: "dashboardId",
        as: "dashboard",
      });

      UserDashboardOrder.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }
  }

  UserDashboardOrder.init(
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      dashboardId: {
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
      modelName: "UserDashboardOrder",
      tableName: "UserDashboardOrders",
      timestamps: true,
    }
  );

  return UserDashboardOrder;
};
