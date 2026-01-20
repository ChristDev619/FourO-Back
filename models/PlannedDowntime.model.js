"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PlannedDowntime extends Model {
    static associate(models) {
      // Association with Job
      PlannedDowntime.belongsTo(models.Job, {
        foreignKey: "jobId",
        as: "job",
      });

      // Association with Line
      PlannedDowntime.belongsTo(models.Line, {
        foreignKey: "lineId",
        as: "line",
      });

      PlannedDowntime.belongsTo(models.Reason, {
        foreignKey: "downtimeReasonId", // Updated field to reference the Reasons table
        as: "downtimeReason",
      });
    }
  }

  PlannedDowntime.init(
    {
      downtimeReasonId: {
        type: DataTypes.INTEGER,
        allowNull: true, // Allow null now, but still references Jobs
        references: {
          model: "Reasons",
          key: "id",
        },
      },
      plannedStartTime: {
        type: DataTypes.DATE,
        allowNull: true, // Removed allowNull restriction
      },
      plannedEndTime: {
        type: DataTypes.DATE,
        allowNull: true, // Removed allowNull restriction
      },
      downtimeDuration: {
        type: DataTypes.INTEGER,
        allowNull: true, // Removed allowNull restriction
      },
      downtimeType: {
        type: DataTypes.STRING,
        allowNull: true, // Removed allowNull restriction
      },
      actualStartTime: {
        type: DataTypes.DATE,
        allowNull: true, // Removed allowNull restriction
      },
      actualEndTime: {
        type: DataTypes.DATE,
        allowNull: true, // Removed allowNull restriction
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true, // Removed allowNull restriction
      },
      jobId: {
        type: DataTypes.INTEGER,
        allowNull: true, // Allow null now, but still references Jobs
        references: {
          model: "Jobs",
          key: "id",
        },
      },
      lineId: {
        type: DataTypes.INTEGER,
        allowNull: true, // Allow null now, but still references Lines
        references: {
          model: "Lines",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "PlannedDowntime",
      tableName: "PlannedDowntimes",
      timestamps: true,
    }
  );

  return PlannedDowntime;
};
