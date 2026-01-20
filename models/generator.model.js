"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Generator extends Model {
    static associate(models) {
      Generator.belongsTo(models.Location, {
        foreignKey: "locationId",
        as: "location",
      });

      Generator.hasMany(models.Tags, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "generator",
        },
        as: "tags",
      });

      Generator.belongsToMany(models.Meters, {
        through: models.GeneratorMeter,
        foreignKey: "generatorId",
        otherKey: "meterId",
        as: "meters",
      });

      Generator.belongsTo(models.TariffType, {
        foreignKey: "tariffTypeId",
        as: "tariffType",
      });
    }
  }

  Generator.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      capacity: { type: DataTypes.FLOAT },
      efficiency: { type: DataTypes.FLOAT },
      kwhPerLiter: { type: DataTypes.FLOAT, allowNull: true },
      operationalStatus: { type: DataTypes.STRING },
      locationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Locations",
          key: "id",
        },
      },
      tariffTypeId: {
        type: DataTypes.INTEGER,
        references: {
          model: "TariffTypes",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "Generator",
      tableName: "Generators",
      timestamps: true,
    }
  );

  return Generator;
};
