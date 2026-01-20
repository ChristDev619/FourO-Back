// models/user.model.js
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.hasOne(models.Profile, {
        foreignKey: "userId",
        as: "profile",
      });
      User.belongsTo(models.Level, {
        foreignKey: "levelId",
        as: "level",
      });
      User.belongsTo(models.Location, {
        foreignKey: "locationId",
        as: "location",
      });
    }
  }
  User.init(
    {
      firstName: { type: DataTypes.STRING, allowNull: true },
      lastName: { type: DataTypes.STRING, allowNull: true },
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      role: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      phoneNumber: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          is: /^[0-9]+$/i,
        },
      },
      isDarkMode: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'is_dark_mode',
      },
      levelId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Levels",
          key: "id",
        },
      },
      locationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Locations",
          key: "id",
        },
      },
      emailVerified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      emailVerificationToken: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      emailVerificationExpires: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      resetPasswordToken: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      resetPasswordExpires: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "User",
      tableName: "Users",
      timestamps: true,
    }
  );

  return User;
};
