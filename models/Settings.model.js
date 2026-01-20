"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Settings extends Model {
    static associate(models) {
      // No associations needed
    }
  }

  Settings.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        defaultValue: 1,
        allowNull: false,
      },
      costPerManHour: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        comment: "Global cost per man hour in currency units (applies to all reports)",
      },
    },
    {
      sequelize,
      modelName: "Settings",
      tableName: "Settings",
      timestamps: true,
    }
  );

  return Settings;
};

