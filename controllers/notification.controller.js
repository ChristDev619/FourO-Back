const { Notification, NotificationEvent, User, Tags, sequelize, Op } = require("../dbInit");
const { formatNotificationArray, formatNotificationTimestamps } = require("../utils/helpers/notificationFormatter");

/**
 * Get all notifications for a user
 */
exports.getUserNotifications = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 0, limit = 20, isRead } = req.query;
        const offset = parseInt(page) * parseInt(limit);

        const whereClause = { userId };
        if (isRead !== undefined) {
            whereClause.isRead = isRead === 'true';
        }

        const { count, rows } = await Notification.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: NotificationEvent,
                    as: 'event',
                    attributes: ['id', 'eventName', 'tagId', 'conditionType'],
                    include: [
                        {
                            model: Tags,
                            as: 'tag',
                            attributes: ['id', 'name', 'ref']
                        }
                    ]
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['createdAt', 'DESC']]
        });

        // Format timestamps to Date objects using utility function
        const formattedRows = formatNotificationArray(rows);

        res.status(200).json({
            data: formattedRows,
            total: count,
            pages: Math.ceil(count / parseInt(limit)),
            currentPage: parseInt(page)
        });

    } catch (error) {
        console.error("Error fetching user notifications:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get notification history with date range and filters
 */
exports.getNotificationHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const { 
            page = 0, 
            limit = 50, 
            isRead, 
            startDate, 
            endDate,
            tagId,
            eventId
        } = req.query;
        const offset = parseInt(page) * parseInt(limit);

        // Build where clause
        const whereClause = { userId };

        // Filter by read status
        if (isRead !== undefined && isRead !== 'all') {
            whereClause.isRead = isRead === 'true';
        }

        // Filter by date range
        if (startDate || endDate) {
            whereClause.createdAt = {};
            if (startDate) {
                whereClause.createdAt[Op.gte] = new Date(startDate);
            }
            if (endDate) {
                // Add 1 day to include the entire end date
                const endDateTime = new Date(endDate);
                endDateTime.setDate(endDateTime.getDate() + 1);
                whereClause.createdAt[Op.lt] = endDateTime;
            }
        }

        // Build include clause
        const includeClause = [
            {
                model: NotificationEvent,
                as: 'event',
                attributes: ['id', 'eventName', 'tagId', 'conditionType'],
                include: [
                    {
                        model: Tags,
                        as: 'tag',
                        attributes: ['id', 'name', 'ref']
                    }
                ]
            }
        ];

        // Filter by event ID
        if (eventId) {
            whereClause.eventId = parseInt(eventId);
        }

        // Filter by tag ID (through event)
        if (tagId) {
            includeClause[0].where = { tagId: parseInt(tagId) };
            includeClause[0].required = true; // Inner join
        }

        const { count, rows } = await Notification.findAndCountAll({
            where: whereClause,
            include: includeClause,
            limit: parseInt(limit),
            offset: offset,
            order: [['createdAt', 'DESC']],
            distinct: true // Important for accurate count with joins
        });

        // Format timestamps to Date objects using utility function
        const formattedRows = formatNotificationArray(rows);

        res.status(200).json({
            data: formattedRows,
            total: count,
            pages: Math.ceil(count / parseInt(limit)),
            currentPage: parseInt(page)
        });

    } catch (error) {
        console.error("Error fetching notification history:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get unread notification count for a user
 */
exports.getUnreadCount = async (req, res) => {
    try {
        const { userId } = req.params;

        const count = await Notification.count({
            where: {
                userId,
                isRead: false
            }
        });

        res.status(200).json({ unreadCount: count });

    } catch (error) {
        console.error("Error getting unread count:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Mark a notification as read
 */
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;

        const notification = await Notification.findByPk(id);
        if (!notification) {
            return res.status(404).json({ error: "Notification not found" });
        }

        if (!notification.isRead) {
            await notification.update({
                isRead: true,
                readAt: new Date()
            });
        }

        // Format timestamps to Date objects using utility function
        const formattedNotification = formatNotificationTimestamps(notification);

        res.status(200).json({
            message: "Notification marked as read",
            notification: formattedNotification
        });

    } catch (error) {
        console.error("Error marking notification as read:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Mark all notifications as read for a user
 */
exports.markAllAsRead = async (req, res) => {
    try {
        const { userId } = req.params;

        const [updatedCount] = await Notification.update(
            {
                isRead: true,
                readAt: new Date()
            },
            {
                where: {
                    userId,
                    isRead: false
                }
            }
        );

        res.status(200).json({
            message: `Marked ${updatedCount} notifications as read`,
            count: updatedCount
        });

    } catch (error) {
        console.error("Error marking all as read:", error);
        res.status(500).json({ error: error.message });
    }
};

// Delete functionality removed - notifications should never be deleted (history is permanent)

module.exports = exports;

