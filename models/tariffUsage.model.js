"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class TariffUsage extends Model {
    static associate(models) {
      TariffUsage.belongsTo(models.Tariff, {
        foreignKey: "tariffId",
        as: "tariff",
      });
    }
  }

  TariffUsage.init(
    {
      startDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      endDate: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      tariffId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Tariffs",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "TariffUsage",
      tableName: "TariffUsages",
      timestamps: true,
    }
  );

  return TariffUsage;
};
