"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Machine extends Model {
    static associate(models) {
      // Existing association with Location
      Machine.belongsTo(models.Location, {
        foreignKey: "locationId",
        as: "location",
      });

      // Existing association with Tags (polymorphic relation)
      Machine.hasMany(models.Tags, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "machine",
        },
        as: "tags",
      });

      // New many-to-many association with Line through LineMachine
      Machine.belongsToMany(models.Line, {
        through: models.LineMachine, // Specify the join model
        foreignKey: "machineId",
        as: "lines",
      });
      Machine.hasMany(models.DesignSpeed, {
        foreignKey: "machineId",
        as: "designSpeeds",
      });
      // Add association for AlarmAggregations
      Machine.hasMany(models.AlarmAggregation, {
        foreignKey: "machineId",
        as: "alarmAggregations",
      });

      Machine.hasMany(models.MachineStateAggregation, {
        foreignKey: "machineId",
        as: "stateAggregations"
      });
    }
  }

  Machine.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING, allowNull: false },
      machineType: { type: DataTypes.STRING },
      operationalStatus: { type: DataTypes.STRING },
      criticality: { type: DataTypes.STRING },
      lastMaintenanceDate: { type: DataTypes.DATE },
      scheduledMaintenanceDate: { type: DataTypes.DATE },
      locationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Locations", // This should match the table name exactly as it is in the database.
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "Machine",
      tableName: "Machines",
      timestamps: true,
    }
  );

  return Machine;
};
