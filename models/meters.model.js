"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Meter extends Model {
    static associate(models) {
      Meter.belongsTo(models.Machine, {
        foreignKey: "machineId",
        as: "machine",
      });
      Meter.belongsTo(models.Location, {
        foreignKey: "locationId",
        as: "location",
      });
      Meter.belongsToMany(models.Generator, {
        through: models.GeneratorMeter,
        foreignKey: "meterId",
        otherKey: "generatorId",
        as: "generators",
      });
      Meter.hasMany(models.Tags, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "meter",
        },
        as: "tags",
      });
    }
  }
  Meter.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false }, // New type field
      machineId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Machines",
          key: "id",
        },
      },
      locationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Locations",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "Meter",
      tableName: "Meters",
      timestamps: true,
    }
  );

  return Meter;
};
