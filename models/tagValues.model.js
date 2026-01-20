const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class TagValues extends Model {
    static associate(models) {
      TagValues.belongsTo(models.Tags, {
        foreignKey: "tagId", // Ensure this matches the foreign key defined in Tags.hasMany
        as: "tags",
      });
    }
  }
  TagValues.init(
    {
      tagId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Tags",
          key: "id",
        },
      },
      value: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "TagValue",
      tableName: "TagValues",
      timestamps: true,
    }
  );

  return TagValues;
};
