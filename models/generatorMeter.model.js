const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class GeneratorMeter extends Model {
    static associate(models) {
      // Define how GeneratorMeter relates to Generator
      GeneratorMeter.belongsTo(models.Generator, {
        foreignKey: 'generatorId',
        as: 'generator'
      });

      // Define how GeneratorMeter relates to Meter
      GeneratorMeter.belongsTo(models.Meters, {
        foreignKey: 'meterId',
        as: 'meter'
      });
    }
  }
  GeneratorMeter.init(
    {
      generatorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Generators",
          key: "id",
        },
      },
      meterId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Meters",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "GeneratorMeter",
      tableName: "GeneratorMeters",
      timestamps: true,
    }
  );

  return GeneratorMeter;
};
