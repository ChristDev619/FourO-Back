// models/AlarmMachineLineView.js
"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class AlarmMachineLineView extends Model {
    static associate(models) {
      // No associations needed since it's a view.
    }
  }

  AlarmMachineLineView.init(
    {
      alarmId: { type: DataTypes.INTEGER, primaryKey: true },
      alarmName: { type: DataTypes.STRING },
      alarmDescription: { type: DataTypes.TEXT },
      machineId: { type: DataTypes.INTEGER },
      machineName: { type: DataTypes.STRING },
      machineType: { type: DataTypes.STRING },
      machineOperationalStatus: { type: DataTypes.STRING },
      machineCriticality: { type: DataTypes.STRING },
      machineLastMaintenanceDate: { type: DataTypes.DATE },
      machineScheduledMaintenanceDate: { type: DataTypes.DATE },
      lineId: { type: DataTypes.INTEGER },
      lineName: { type: DataTypes.STRING },
      lineLocationId: { type: DataTypes.INTEGER },
      lineBottleneckMachineId: { type: DataTypes.INTEGER },
    },
    {
      sequelize,
      modelName: "AlarmMachineLineView",
      tableName: "AlarmMachineLineView",
      timestamps: false, // Views generally don't have timestamps.
    }
  );

  return AlarmMachineLineView;
};
