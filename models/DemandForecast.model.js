const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class DemandForecast extends Model {
    static associate(models) {
      // Optional: Associate with User if you want user-specific forecasts
      DemandForecast.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }
  }

  DemandForecast.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Demand Forecast",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Store the entire forecast structure as JSON
      // Structure: {
      //   years: [{id, label, year, isCurrent}],
      //   categories: [{
      //     id, name, expanded, 
      //     growth: {year0: %, year1: %, ...},
      //     packages: [{
      //       id, recipeId, recipeName, bottlesPerCase, volume,
      //       yearValues: {year-1: value, year0: value, ...}
      //     }]
      //   }]
      // }
      forecastData: {
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
      modelName: "DemandForecast",
      tableName: "DemandForecasts",
      timestamps: true,
    }
  );

  return DemandForecast;
};

