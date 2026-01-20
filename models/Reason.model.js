const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Reason extends Model {}

  Reason.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT },
    },
    { sequelize, modelName: "Reason", tableName: "Reasons", timestamps: true }
  );

  return Reason;
};
