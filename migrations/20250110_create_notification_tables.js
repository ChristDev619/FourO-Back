'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create NotificationEvents table
    await queryInterface.createTable('NotificationEvents', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      eventName: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      tagId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Tags',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      conditionType: {
        type: Sequelize.ENUM('value_change', 'threshold', 'state_change'),
        allowNull: false,
      },
      thresholdValue: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      comparisonOperator: {
        type: Sequelize.ENUM('>', '<', '=', '>=', '<=', '!='),
        allowNull: true,
      },
      targetState: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      selectedUsers: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: '[]',
      },
      filterByLocationId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'locations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      filterByLineId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Lines',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      sendEmail: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sendInApp: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastTriggeredAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cooldownMinutes: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    // Add indexes for NotificationEvents
    await queryInterface.addIndex('NotificationEvents', ['tagId'], {
      name: 'idx_notification_events_tag_id',
    });
    await queryInterface.addIndex('NotificationEvents', ['isActive'], {
      name: 'idx_notification_events_is_active',
    });
    await queryInterface.addIndex('NotificationEvents', ['tagId', 'isActive'], {
      name: 'idx_notification_events_tag_active',
    });

    // Create Notifications table
    await queryInterface.createTable('Notifications', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      eventId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'NotificationEvents',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      tagValue: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      oldTagValue: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      isRead: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notificationType: {
        type: Sequelize.ENUM('email', 'in_app', 'both'),
        allowNull: false,
        defaultValue: 'both',
      },
      emailSent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      emailSentAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      readAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
      },
    });

    // Add indexes for Notifications
    await queryInterface.addIndex('Notifications', ['userId'], {
      name: 'idx_notifications_user_id',
    });
    await queryInterface.addIndex('Notifications', ['userId', 'isRead'], {
      name: 'idx_notifications_user_read',
    });
    await queryInterface.addIndex('Notifications', ['eventId'], {
      name: 'idx_notifications_event_id',
    });
    await queryInterface.addIndex('Notifications', ['createdAt'], {
      name: 'idx_notifications_created_at',
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Drop tables in reverse order (due to foreign keys)
    await queryInterface.dropTable('Notifications');
    await queryInterface.dropTable('NotificationEvents');
  },
};

