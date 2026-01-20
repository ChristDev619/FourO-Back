const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PackageType extends Model {
    static associate(models) {
      // PackageType has many Recipes
      PackageType.hasMany(models.Recipie, {
        foreignKey: "packageTypeId",
        as: "recipes",
      });
    }
  }

  PackageType.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: "PackageType",
      tableName: "PackageTypes",
      timestamps: true,
    }
  );

  return PackageType;
};

