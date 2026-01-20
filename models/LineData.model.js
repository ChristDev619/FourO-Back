const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class LineData extends Model {
    static associate(models) {
      // Optional: Associate with User if you want user-specific line data
      LineData.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }
  }

  LineData.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Line Data",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Store the entire line data structure as JSON
      // Structure: {
      //   years: [{id, label, year, isCurrent}],
      //   lineUtilizationByMonth: {
      //     "year-1": {
      //       "jan": [{
      //         id, plantId, plantName, lineId, lineName, locationId,
      //         availableHours, hoursUsed, hoursRemaining, lineUtilization
      //       }],
      //       "feb": [...], ...
      //     }
      //   },
      //   lineDetailsByMonth: {
      //     "year-1": {
      //       "jan": [{
      //         id, plantId, lineId, lineName, mfrName, recipeId, recipeName,
      //         package, size, fillerRatedSpeed, bottlesPerCase,
      //         lineHoursAllocation, actualEfficiency,
      //         actualCapacityCases, standardCapacityCases
      //       }],
      //       "feb": [...], ...
      //     }
      //   }
      // }
      lineData: {
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
      modelName: "LineData",
      tableName: "LineData",
      timestamps: true,
    }
  );

  return LineData;
};

