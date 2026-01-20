const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class LineMachine extends Model {}

  LineMachine.init(
    {
      lineId: {
        type: DataTypes.INTEGER,
        references: {
          model: "Lines",
          key: "id",
        },
      },
      machineId: {
        type: DataTypes.INTEGER,
        references: {
          model: "Machines",
          key: "id",
        },
      },
      startDate: { type: DataTypes.DATE, allowNull: false },
      endDate: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: "LineMachine", tableName: "LineMachines", timestamps: true }
  );

  return LineMachine;
};
