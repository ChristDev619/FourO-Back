// models/MachineStateAggregation.model.js
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class MachineStateAggregation extends Model {
    static associate(models) {
      // Association with Job
      MachineStateAggregation.belongsTo(models.Job, {
        foreignKey: "jobId",
        as: "job",
      });

      // Association with Line
      MachineStateAggregation.belongsTo(models.Line, {
        foreignKey: "lineId",
        as: "line",
      });

      // Association with Machine
      MachineStateAggregation.belongsTo(models.Machine, {
        foreignKey: "machineId",
        as: "machine",
      });

      // Association with Tag
      MachineStateAggregation.belongsTo(models.Tags, {
        foreignKey: "tagId",
        as: "tag",
      });
    }
  }

  MachineStateAggregation.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      jobId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Jobs", key: "id" },
      },
      machineId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Machines", key: "id" },
      },
      machineName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      tagId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Tags", key: "id" },
      },
      tagName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      lineId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Lines", key: "id" },
      },
      lineName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      stateCode: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      stateName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      stateStartDateTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      stateEndDateTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      duration: {
        type: DataTypes.INTEGER, // Duration in minutes
        allowNull: false,
      },
      userNote: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      processed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "MachineStateAggregation",
      tableName: "MachineStateAggregations",
      timestamps: true,
      indexes: [
        {
          name: "idx_machine_state_job",
          fields: ["jobId"],
        },
        {
          name: "idx_machine_state_machine",
          fields: ["machineId"],
        },
        {
          name: "idx_machine_state_line",
          fields: ["lineId"],
        },
        {
          name: "idx_machine_state_tag",
          fields: ["tagId"],
        },
        {
          name: "idx_machine_state_processed",
          fields: ["processed"],
        },
        {
          name: "idx_machine_state_datetime",
          fields: ["stateStartDateTime", "stateEndDateTime"],
        },
      ],
    }
  );

  return MachineStateAggregation;
};
