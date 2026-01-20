const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PackageSummary extends Model {
    static associate(models) {
      // Optional: Associate with User if you want to track who created it
      PackageSummary.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });
    }
  }

  PackageSummary.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Package Summary",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      summaryData: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {
          years: [],
          packagesByYear: {},
        },
        comment: "Stores all package summary data including years, packages, monthly data, and calculations",
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Users",
          key: "id",
        },
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: "PackageSummary",
      tableName: "PackageSummaries",
      timestamps: true,
    }
  );

  return PackageSummary;
};

