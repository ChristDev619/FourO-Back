const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Line extends Model {
    static associate(models) {
      // Many-to-many relationship with Recipie
      Line.belongsToMany(models.Recipie, {
        through: models.LineRecipie,
        foreignKey: "lineId",
        as: "recipies",
      });

      // Many-to-many relationship with Machine (existing)
      Line.belongsToMany(models.Machine, {
        through: models.LineMachine,
        foreignKey: "lineId",
        as: "machines",
      });

      // One-to-many relationship with Job (existing)
      Line.hasMany(models.Job, { foreignKey: "lineId", as: "jobs" });

      // Bottleneck Machine association (existing)
      Line.belongsTo(models.Machine, {
        foreignKey: "bottleneckMachineId",
        as: "bottleneckMachine",
      });

      // Add association for AlarmAggregations
      Line.hasMany(models.AlarmAggregation, {
        foreignKey: "lineId",
        as: "alarmAggregations",
      });

      // Location association (existing)
      Line.belongsTo(models.Location, {
        foreignKey: "locationId",
        as: "location",
      });

      // Tags association (existing)
      Line.hasMany(models.Tags, {
        foreignKey: "taggableId",
        constraints: false,
        scope: {
          taggableType: "line",
        },
        as: "tags",
      });
      Line.hasMany(models.MachineStateAggregation, {
        foreignKey: "lineId",
        as: "machineStates"
      });
    }
  }

  Line.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      locationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Locations",
          key: "id",
        },
      },
      bottleneckMachineId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Machines",
          key: "id",
        },
      },
    },
    { sequelize, modelName: "Line", tableName: "Lines", timestamps: true }
  );

  return Line;
};
