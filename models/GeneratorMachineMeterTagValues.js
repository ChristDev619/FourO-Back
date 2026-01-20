module.exports = (sequelize, DataTypes) => {
  const GeneratorMachineMeterTagValues = sequelize.define(
    "GeneratorMachineMeterTagValues",
    {
      generator_id: DataTypes.INTEGER,
      generator_name: DataTypes.STRING,
      tariffType: DataTypes.STRING,
      tariff_type_id: DataTypes.INTEGER,
      kwhPerLiter: DataTypes.FLOAT,
      machine_id: DataTypes.INTEGER,
      machine_name: DataTypes.STRING,
      meter_id: DataTypes.INTEGER,
      meter_name: DataTypes.STRING,
      meter_type: DataTypes.STRING,
      tag_id: DataTypes.INTEGER,
      tag_name: DataTypes.STRING,
      tag_unit_id: DataTypes.INTEGER,
    },
    {
      tableName: "GeneratorMachineMeterTagValues",
      timestamps: false,
    }
  );
  return GeneratorMachineMeterTagValues;
};
