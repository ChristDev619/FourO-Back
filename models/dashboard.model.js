"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Dashboard extends Model {
    static associate(models) {
      Dashboard.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
      Dashboard.hasMany(models.Card, {
        foreignKey: "dashboardId",
        as: "cards",
      });
    }
  }

  Dashboard.init(
    {
      title: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
      },
      layout: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Stores the layout of the cards in JSON format",
      },
      isFavorite: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        comment: "Indicates if the dashboard is marked as favorite",
      },
    },
    {
      sequelize,
      modelName: "Dashboard",
      tableName: "Dashboards",
      timestamps: true,
    }
  );

  return Dashboard;
};
