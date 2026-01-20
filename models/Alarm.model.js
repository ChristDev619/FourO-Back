// models/Alarm.model.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Alarm extends Model {
    static associate(models) {
      Alarm.belongsTo(models.Machine, {
        foreignKey: "machineId",
        as: "machine",
      });

      // Add association for AlarmAggregations
      Alarm.hasMany(models.AlarmAggregation, {
        foreignKey: "alarmCode",
        sourceKey: "name", // Use the name field as the source
        as: "aggregations",
      });
    }
  }

  Alarm.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      machineId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Machines",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "Alarm",
      tableName: "Alarms",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["machineId", "name"], // Composite unique index
          name: "idx_machine_alarm_name",
        },
        {
          fields: ["name"], // Non-unique index on name for the foreign key reference
          name: "idx_alarm_name",
        },
      ],
    }
  );

  return Alarm;
};
