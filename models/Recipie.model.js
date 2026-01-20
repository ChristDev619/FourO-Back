const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Recipie extends Model {
    static associate(models) {
      // Belongs to one SKU
      Recipie.belongsTo(models.Sku, {
        foreignKey: "skuId",
        as: "sku",
      });

      // Belongs to one PackageType (optional)
      Recipie.belongsTo(models.PackageType, {
        foreignKey: "packageTypeId",
        as: "packageType",
      });

      // Many-to-many relationship with Line (new)
      Recipie.belongsToMany(models.Line, {
        through: models.LineRecipie, // Junction table
        foreignKey: "recipieId",
        as: "lines",
      });

      
    }
  }

  Recipie.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      number: { type: DataTypes.STRING, allowNull: false },
      
      skuId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Skus", key: "id" },
      },
      
      packageTypeId: {
        type: DataTypes.INTEGER,
        allowNull: true, // Optional - recipes can exist without package type
        references: { model: "PackageTypes", key: "id" },
      },
    },
    { sequelize, modelName: "Recipie", tableName: "Recipes", timestamps: true }
  );

  return Recipie;
};
