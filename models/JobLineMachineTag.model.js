module.exports = (sequelize, DataTypes) => {
  const JobLineMachineTag = sequelize.define(
    "JobLineMachineTag",
    {
      jobId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
      },
      jobName: DataTypes.STRING,
      jobDescription: DataTypes.TEXT,
      plannedStartTime: DataTypes.DATE,
      plannedEndTime: DataTypes.DATE,
      plannedProduction: DataTypes.INTEGER,
      actualStartTime: DataTypes.DATE,
      actualEndTime: DataTypes.DATE,
      actualProduction: DataTypes.INTEGER,
      lineId: DataTypes.INTEGER,
      skuId: DataTypes.INTEGER,
      lineName: DataTypes.STRING,
      locationId: DataTypes.INTEGER,
      bottleneckMachineId: DataTypes.INTEGER,
      machineId: DataTypes.INTEGER,
      machineName: DataTypes.STRING,
      machineType: DataTypes.STRING,
      operationalStatus: DataTypes.STRING,
      criticality: DataTypes.STRING,
      lastMaintenanceDate: DataTypes.DATE,
      scheduledMaintenanceDate: DataTypes.DATE,
      machineLocationId: DataTypes.INTEGER,
      tagId: DataTypes.INTEGER,
      tagName: DataTypes.STRING,
      ref: DataTypes.STRING,
      HH: DataTypes.FLOAT,
      H: DataTypes.FLOAT,
      LL: DataTypes.FLOAT,
      L: DataTypes.FLOAT,
      HHC: DataTypes.FLOAT,
      HC: DataTypes.FLOAT,
      LLC: DataTypes.FLOAT,
      LC: DataTypes.FLOAT,
      unitId: DataTypes.INTEGER,
    },
    {
      sequelize,
      modelName: "JobLineMachineTag",
      tableName: "JobLineMachineTag",
      timestamps: false,
    }
  );

  return JobLineMachineTag;
};
