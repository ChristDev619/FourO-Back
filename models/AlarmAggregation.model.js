// models/AlarmAggregation.model.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class AlarmAggregation extends Model {
    static associate(models) {
      // Keep existing associations
      AlarmAggregation.belongsTo(models.Job, {
        foreignKey: "jobId",
        as: "job",
      });

      AlarmAggregation.belongsTo(models.Line, {
        foreignKey: "lineId",
        as: "line",
      });

      AlarmAggregation.belongsTo(models.Machine, {
        foreignKey: "machineId",
        as: "machine",
      });

      AlarmAggregation.belongsTo(models.Tags, {
        foreignKey: "tagId",
        as: "tag",
      });

      AlarmAggregation.belongsTo(models.Reason, {
        foreignKey: "alarmReasonId",
        as: "reason",
      });

      // Modified alarm association
      AlarmAggregation.belongsTo(models.Alarm, {
        foreignKey: "alarmCode",
        targetKey: "name", // Reference the name field
        as: "alarmDetails",
        constraints: false
      });
    }
  }

  AlarmAggregation.init(
    {
      jobId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      machineId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      machineName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      tagId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      tagName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      lineId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      lineName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      alarmCode: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      alarmStartDateTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      alarmEndDateTime: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      duration: {
        type: DataTypes.FLOAT,
        allowNull: false,
        comment: "Duration in minutes",
      },
      alarmReasonId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      alarmReasonName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      alarmNote: {
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
      modelName: "AlarmAggregation",
      tableName: "AlarmAggregations",
      timestamps: true,
      indexes: [
        {
          fields: ["jobId"],
          name: "idx_alarm_agg_job",
        },
        {
          fields: ["machineId"],
          name: "idx_alarm_agg_machine",
        },
        {
          fields: ["lineId"],
          name: "idx_alarm_agg_line",
        },
        {
          fields: ["tagId"],
          name: "idx_alarm_agg_tag",
        },
        {
          fields: ["alarmReasonId"],
          name: "idx_alarm_agg_reason",
        },
        {
          fields: ["alarmCode"],
          name: "idx_alarm_agg_code",
        },
      ],
    }
  );

  return AlarmAggregation;
};
