"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class DesignSpeed extends Model {
    static associate(models) {
      // Each DesignSpeed belongs to one Machine
      DesignSpeed.belongsTo(models.Machine, {
        foreignKey: "machineId",
        as: "machine",
      });
    }
  }

  DesignSpeed.init(
    {
      value: { type: DataTypes.FLOAT, allowNull: false }, // Design speed value
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
      modelName: "DesignSpeed",
      tableName: "DesignSpeeds",
      timestamps: true,
    }
  );

  return DesignSpeed;
};
