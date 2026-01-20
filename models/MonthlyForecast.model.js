const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class MonthlyForecast extends Model {
    static associate(models) {
      // Optional: Associate with User if you want user-specific forecasts
      MonthlyForecast.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }
  }

  MonthlyForecast.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Monthly Forecast",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Store the entire monthly forecast structure as JSON
      // Structure: {
      //   years: [{id, label, year, isCurrent}],
      //   packagesByYear: {
      //     "year-1": [{
      //       id, recipeId, recipeName,
      //       monthlyVolumes: {jan: 104, feb: 91, ..., dec: 129},
      //       yearlyTotal: 2229
      //     }],
      //     "year0": [...],
      //     ...
      //   }
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
      modelName: "MonthlyForecast",
      tableName: "MonthlyForecasts",
      timestamps: true,
    }
  );

  return MonthlyForecast;
};

