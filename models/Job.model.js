const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Job extends Model {
    static associate(models) {
      // Each job belongs to one line
      Job.belongsTo(models.Line, {
        foreignKey: "lineId",
        as: "line",
      });

      // Each job belongs to one SKU
      Job.belongsTo(models.Sku, {
        foreignKey: "skuId",
        as: "sku",
      });

      // Each job belongs to one program
      Job.belongsTo(models.Program, {
        foreignKey: "programId",
        as: "program",
      });

      // Add association for AlarmAggregations
      Job.hasMany(models.AlarmAggregation, {
        foreignKey: "jobId",
        as: "alarmAggregations",
      });

      Job.hasMany(models.MachineStateAggregation, {
        foreignKey: "jobId",
        as: "machineStates",
      });
    }
  }

  Job.init(
    {
      jobName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      jobDescription: {
        type: DataTypes.TEXT,
      },
      plannedStartTime: {
        type: DataTypes.DATE,
      },
      plannedEndTime: {
        type: DataTypes.DATE,
      },
      plannedProduction: {
        type: DataTypes.INTEGER,
      },
      actualStartTime: {
        type: DataTypes.DATE,
      },
      actualEndTime: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      actualProduction: {
        type: DataTypes.INTEGER,
      },
      lineId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Lines",
          key: "id",
        },
      },
      skuId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Skus",
          key: "id",
        },
      },
      programId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Programs",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "Job",
      tableName: "Jobs",
      timestamps: true,
    }
  );

  return Job;
};