const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class LineRecipie extends Model {
    static associate(models) {
      LineRecipie.belongsTo(models.DesignSpeed, {
        foreignKey: "designSpeedId",
        as: "designSpeed",
      });
      LineRecipie.belongsTo(models.Line, {
        foreignKey: "lineId",
        as: "line",
      });
      LineRecipie.belongsTo(models.Recipie, {
        foreignKey: "recipieId",
        as: "recipie",
      });
    }
  }

  LineRecipie.init(
    {
      lineId: {
        type: DataTypes.INTEGER,
        references: {
          model: "Lines",
          key: "id",
        },
      },
      recipieId: {
        type: DataTypes.INTEGER,
        references: {
          model: "Recipies",
          key: "id",
        },
      },
      designSpeedId: {
        type: DataTypes.INTEGER,
        references: {
          model: "DesignSpeeds", // assuming you named it "DesignSpeeds"
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "LineRecipie",
      tableName: "LineRecipies",
      timestamps: true,
    }
  );

  return LineRecipie;
};
