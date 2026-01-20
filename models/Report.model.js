"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Report extends Model {
    static associate(models) {
      // No associations needed
    }
  }

    Report.init(
        {
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            type: {
                type: DataTypes.STRING,
                defaultValue: "LMS",
                allowNull: false,
            },
            config: {
                type: DataTypes.JSON,
                allowNull: true,
                comment: "Stores the report configuration data in JSON format",
            },
            sortOrder: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            isFavorite: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
                allowNull: false,
                comment: "Indicates if the report is marked as favorite",
            },
            volumeOfDiesel: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true,
                defaultValue: 0,
                comment: "Volume of diesel in liters (user input for EMS calculations)",
            },
            manHours: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true,
                defaultValue: 0,
                comment: "Man hours (user input for report calculations)",
            },
        },
        {
            sequelize,
            modelName: "Report",
            tableName: "Reports",
            timestamps: true,
        }
    );

  return Report;
};