const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class NotificationEvent extends Model {
    static associate(models) {
      // Belongs to Tag - the tag being monitored
      NotificationEvent.belongsTo(models.Tags, {
        foreignKey: "tagId",
        as: "tag",
      });

      // Belongs to User - creator of the event
      NotificationEvent.belongsTo(models.User, {
        foreignKey: "createdBy",
        as: "creator",
      });

      // Optional: Filter by Location
      NotificationEvent.belongsTo(models.Location, {
        foreignKey: "filterByLocationId",
        as: "filterLocation",
        allowNull: true,
      });

      // Optional: Filter by Line
      NotificationEvent.belongsTo(models.Line, {
        foreignKey: "filterByLineId",
        as: "filterLine",
        allowNull: true,
      });

      // Has many notifications
      NotificationEvent.hasMany(models.Notification, {
        foreignKey: "eventId",
        as: "notifications",
      });
    }
  }

  NotificationEvent.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      eventName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "Description that will be shown in the notification. Supports placeholders: {{value}}, {{oldValue}}, {{newValue}}",
      },
      tagId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Tags",
          key: "id",
        },
      },
      conditionType: {
        type: DataTypes.ENUM("value_change", "threshold", "state_change"),
        allowNull: false,
        comment: "Type of condition to monitor",
      },
      thresholdValue: {
        type: DataTypes.FLOAT,
        allowNull: true,
        comment: "Threshold value for comparison (only for threshold condition type)",
      },
      comparisonOperator: {
        type: DataTypes.ENUM(">", "<", "=", ">=", "<=", "!="),
        allowNull: true,
        comment: "Comparison operator for threshold (only for threshold condition type)",
      },
      targetState: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Target state value to match (only for state_change condition type)",
      },
      stateDuration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "Duration value - how long state must persist before triggering notification (optional)",
      },
      stateDurationUnit: {
        type: DataTypes.ENUM('seconds', 'minutes', 'hours'),
        allowNull: true,
        defaultValue: 'minutes',
        comment: "Duration unit - time unit for stateDuration field",
      },
      selectedUsers: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
        comment: "Array of user IDs to notify: [userId1, userId2, ...]",
      },
      filterByLocationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "locations",
          key: "id",
        },
        comment: "Optional: Filter users by location",
      },
      filterByLineId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Lines",
          key: "id",
        },
        comment: "Optional: Filter users by line",
      },
      sendEmail: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Send email notification when triggered",
      },
      sendInApp: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Send in-app notification when triggered",
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Whether this event is active and should be checked",
      },
      lastTriggeredAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Last time this event was triggered (for rate limiting)",
      },
      cooldownMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
        comment: "Minimum minutes between notifications for this event (prevents spam)",
      },
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      // ============================================
      // ESCALATION SYSTEM FIELDS
      // ============================================
      enableEscalation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Enable escalation workflow for this event",
      },
      escalationDelay: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "Time to wait before escalating (e.g., 2 hours)",
      },
      escalationDelayUnit: {
        type: DataTypes.ENUM('minutes', 'hours', 'days'),
        allowNull: true,
        defaultValue: 'hours',
        comment: "Unit for escalation delay",
      },
      escalationUserIds: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Ordered array of user IDs for sequential escalation: [manager, director, ceo]",
      },
      maxEscalationLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "Maximum escalation levels (1=single, 2+=multi-level)",
      },
    },
    {
      sequelize,
      modelName: "NotificationEvent",
      tableName: "NotificationEvents",
      timestamps: true,
      indexes: [
        {
          fields: ["tagId"],
          name: "idx_notification_events_tag_id",
        },
        {
          fields: ["isActive"],
          name: "idx_notification_events_is_active",
        },
        {
          fields: ["tagId", "isActive"],
          name: "idx_notification_events_tag_active",
        },
        {
          fields: ["enableEscalation", "isActive"],
          name: "idx_escalation_enabled",
        },
      ],
    }
  );

  return NotificationEvent;
};

