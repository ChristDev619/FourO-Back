const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Program extends Model {
        static associate(models) {
            Program.hasMany(models.Job, {
                foreignKey: "programId",
                as: "jobs", // must match your eager load alias
            });
        }
    }

    Program.init(
        {
            number: { type: DataTypes.STRING, allowNull: false },
            programName: { type: DataTypes.STRING, allowNull: false },
            description: { type: DataTypes.TEXT },
            startDate: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: "Start datetime of the program",
            },
            endDate: {
                type: DataTypes.DATE,
                allowNull: true,
                comment: "End datetime of the program",
            },
            lineId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: "Lines",
                    key: "id",
                },
            },
        },
        {
            sequelize,
            modelName: "Program",
            tableName: "Programs",
            timestamps: true,
        }
    );

    return Program;
};
