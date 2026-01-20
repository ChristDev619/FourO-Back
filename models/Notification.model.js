const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Notification extends Model {
    static associate(models) {
      // Belongs to NotificationEvent
      Notification.belongsTo(models.NotificationEvent, {
        foreignKey: "eventId",
        as: "event",
      });

      // Belongs to User - recipient of the notification
      Notification.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });

      // Self-reference: Parent notification (for escalation chain)
      Notification.belongsTo(models.Notification, {
        foreignKey: "parentNotificationId",
        as: "parentNotification",
      });

      // Has many escalated notifications
      Notification.hasMany(models.Notification, {
        foreignKey: "parentNotificationId",
        as: "escalatedNotifications",
      });
    }
  }

  Notification.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      eventId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "NotificationEvents",
          key: "id",
        },
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "Formatted notification message with placeholders replaced",
      },
      tagValue: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "The tag value that triggered this notification",
      },
      oldTagValue: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "The previous tag value (for value_change conditions)",
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notificationType: {
        type: DataTypes.ENUM("email", "in_app", "both"),
        allowNull: false,
        defaultValue: "both",
      },
      emailSent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether the email was successfully sent",
      },
      emailSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // ============================================
      // EMAIL ACKNOWLEDGMENT SYSTEM
      // ============================================
      emailToken: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
        comment: "Secure token for email acknowledgment link (64-char hex)",
      },
      acknowledgedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Timestamp when user clicked acknowledge in email",
      },
      tokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Token expiration (90 days from creation)",
      },
      // ============================================
      // ESCALATION TRACKING
      // ============================================
      escalationLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Current escalation level: 0=original, 1=first escalation, 2=second, etc.",
      },
      escalationJobId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Bull queue job ID for scheduled escalation check",
      },
      parentNotificationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Notifications",
          key: "id",
        },
        comment: "Reference to original notification ID (for escalated copies)",
      },
    },
    {
      sequelize,
      modelName: "Notification",
      tableName: "Notifications",
      timestamps: true,
      indexes: [
        {
          fields: ["userId"],
          name: "idx_notifications_user_id",
        },
        {
          fields: ["userId", "isRead"],
          name: "idx_notifications_user_read",
        },
        {
          fields: ["eventId"],
          name: "idx_notifications_event_id",
        },
        {
          fields: ["createdAt"],
          name: "idx_notifications_created_at",
        },
        {
          fields: ["emailToken"],
          name: "idx_email_token",
        },
        {
          fields: ["acknowledgedAt", "escalationJobId"],
          name: "idx_escalation_check",
        },
        {
          fields: ["escalationLevel", "parentNotificationId"],
          name: "idx_escalation_level",
        },
        {
          fields: ["tokenExpiresAt"],
          name: "idx_token_expiry",
        },
      ],
    }
  );

  return Notification;
};

