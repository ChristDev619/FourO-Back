const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Level extends Model {
    static associate(models) {}
  }
  Level.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      accessList: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      allowedDashboards: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Stores array of dashboard IDs that this access level can access",
      },
      allowedReports: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Stores array of report IDs that this access level can access",
      },
    },
    {
      sequelize,
      modelName: "Level",
      tableName: "Levels",
      timestamps: true,

    }
  );

  return Level;
};
