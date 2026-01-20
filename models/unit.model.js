// models/unit.js
"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Unit extends Model {
    static associate(models) {
      Unit.hasMany(models.Tags, {
        foreignKey: "unitId",
        as: "tags",
      });
    }
  }
  Unit.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "Unit",
      tableName: "Units",
      timestamps: true,
    }
  );

  return Unit;
};
