const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class TariffType extends Model {
    static associate(models) {
      // Define associations here if needed
    }
  }
  TariffType.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "TariffType",
      tableName: "TariffTypes",
      timestamps: true,
    }
  );

  return TariffType;
};
