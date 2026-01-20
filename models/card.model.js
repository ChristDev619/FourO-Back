"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Card extends Model {
    static associate(models) {
      Card.belongsTo(models.Dashboard, {
        foreignKey: "dashboardId",
        as: "dashboard",
      });
    }
  }

  Card.init(
    {
      title: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      dashboardId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Dashboards",
          key: "id",
        },
      },
      config: {
        type: DataTypes.JSON,
        allowNull: true, // JSON field for storing chart-specific configurations
      },
      cardIndex: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      counter: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Card",
      tableName: "Cards",
      timestamps: true,
    }
  );

  return Card;
};
