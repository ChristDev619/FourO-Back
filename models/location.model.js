"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Location extends Model {
    static associate(models) {
      Location.belongsTo(models.Location, {
        foreignKey: "parentLocationId",
        as: "parent",
      });
      Location.hasMany(models.Location, {
        foreignKey: "parentLocationId",
        as: "children",
      });
      Location.hasMany(models.User, {
        foreignKey: "locationId",
        as: "users",
      });
    }
  }
  Location.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      parentLocationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Locations",
          key: "id",
        },
      },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING },
      squareFootage: { type: DataTypes.FLOAT },
      type: { type: DataTypes.STRING },
    },
    {
      sequelize,
      modelName: "Location",
      tableName: "Locations",
      timestamps: true,

    }
  );

  return Location;
};
