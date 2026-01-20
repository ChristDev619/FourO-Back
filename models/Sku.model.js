const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Sku extends Model {
    static associate(models) {
      // Each SKU has one recipe
      Sku.hasOne(models.Recipie, {
        foreignKey: "skuId",
        as: "recipie",
      });
    }
  }

  Sku.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT },
      numberOfContainersPerPack: {
        type: DataTypes.INTEGER,
        allowNull: true, // Adjust based on your requirements
      },
      sizeValue: {
        type: DataTypes.DECIMAL(10, 3),
        allowNull: true,
        comment: "Numeric size value (e.g., 0.5, 6, 500)",
      },
      sizeUnit: {
        type: DataTypes.STRING(10),
        allowNull: true,
        defaultValue: "L",
        comment: "Size unit: L, mL, Gal, oz",
      },
    },
    { sequelize, modelName: "Sku", tableName: "Skus", timestamps: true }
  );

  return Sku;
};
