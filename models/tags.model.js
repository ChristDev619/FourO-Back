"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Tags extends Model {
    static associate(models) {
      Tags.belongsTo(models.Line, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "line",
        },
        as: "line",
      });
      Tags.belongsTo(models.Meters, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "meter",
        },
      });
      Tags.belongsTo(models.Machine, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "machine",
        },
      });
      Tags.belongsTo(models.Generator, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "generator",
        },
      });
      Tags.belongsTo(models.Unit, {
        foreignKey: "unitId",
        as: "unit",
      });
      // Add association for AlarmAggregations
      Tags.hasMany(models.AlarmAggregation, {
        foreignKey: "tagId",
        as: "alarmAggregations",
      });
      Tags.hasMany(models.MachineStateAggregation, {
        foreignKey: "tagId",
        as: "stateAggregations"
      });
    }
  }
  Tags.init(
    {
      taggableId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      taggableType: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      unitId: {
        type: DataTypes.INTEGER,
        references: {
          model: "Units",
          key: "id",
        },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ref: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      HH: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      H: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      LL: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      L: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      HHC: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      HC: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      LLC: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      LC: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      currentValue: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Current/latest value of the tag for quick access without querying TagValues'
      },
      lastValueUpdatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp when currentValue was last updated'
      },
    },
    {
      sequelize,
      modelName: "Tag",
      tableName: "Tags",
      timestamps: true,
    }
  );

  return Tags;
};
