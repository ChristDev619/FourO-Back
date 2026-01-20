const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class AccessList extends Model {
    static associate(models) {
      AccessList.belongsTo(models.Level, {
        foreignKey: "levelId",
        as: "level",
      });
    }
  }
  AccessList.init(
    {
      pages: {
        type: DataTypes.JSON,
        allowNull: false,
        comment: "Stores page access rights in JSON format",
      },
    },
    {
      sequelize,
      modelName: "AccessList",
      tableName: "AccessLists",
      timestamps: true,

    }
  );

  return AccessList;
};
