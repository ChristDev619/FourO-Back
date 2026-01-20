"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Tariff extends Model {
    static associate(models) {
      // Association with TariffType
      Tariff.belongsTo(models.TariffType, {
        foreignKey: "typeId",
        as: "type",
      });
    }
  }

  Tariff.init(
    {
      date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      volume: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      supplier: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      pricePerLiter: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      totalPrice: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      typeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "TariffTypes",
          key: "id",
        },
      },
      billValue: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      tariffName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      invoiceReference: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "Tariff",
      tableName: "Tariffs",
      timestamps: true,
    }
  );

  return Tariff;
};
