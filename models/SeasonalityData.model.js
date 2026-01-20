const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class SeasonalityData extends Model {
    static associate(models) {
      // Optional: Associate with User if you want user-specific seasonality data
      SeasonalityData.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }
  }

  SeasonalityData.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Seasonality Data",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Store the entire seasonality structure as JSON
      // Structure: {
      //   years: [{id, label, year, isCurrent}],
      //   packagesByYear: {
      //     "year-1": [{
      //       id, recipeId, recipeName,
      //       monthlyValues: {jan: 5.56, feb: 5.47, ..., dec: 5.50},
      //       seasonalityFactor: 11.97
      //     }],
      //     "year0": [...],
      //     ...
      //   }
      // }
      seasonalityData: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: "SeasonalityData",
      tableName: "SeasonalityData",
      timestamps: true,
    }
  );

  return SeasonalityData;
};

