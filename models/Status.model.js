const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class Status extends Model {
        static associate(models) {
            // Add associations if needed in the future
        }
    }

    Status.init(
        {
            code: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true, // Ensure unique state code like 128, 1024, etc.
            },
            name: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true, // Constraint to ensure unique names
                validate: {
                    notEmpty: true, // Prevent empty strings
                },
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "Status",
            tableName: "Statuses",
            timestamps: true,
        }
    );

    return Status;
};
