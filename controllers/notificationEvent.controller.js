const { NotificationEvent, Notification, User, Tags, Location, Line, sequelize, Op } = require("../dbInit");
const { validateDuration } = require("../utils/helpers/durationConverter");

/**
 * Create a new notification event
 */
exports.createEvent = async (req, res) => {
    try {
        const {
            eventName,
            description,
            tagId,
            conditionType,
            thresholdValue,
            comparisonOperator,
            targetState,
            stateDuration,
            stateDurationUnit,
            selectedUsers,
            filterByLocationId,
            filterByLineId,
            sendEmail,
            sendInApp,
            cooldownMinutes,
            // Escalation fields
            enableEscalation,
            escalationDelay,
            escalationDelayUnit,
            escalationUserIds,
            maxEscalationLevel
        } = req.body;

        // Validation
        if (!eventName || !description || !tagId || !conditionType) {
            return res.status(400).json({
                error: "Missing required fields: eventName, description, tagId, conditionType"
            });
        }

        // Validate condition-specific fields
        if (conditionType === 'threshold' && (!thresholdValue || !comparisonOperator)) {
            return res.status(400).json({
                error: "Threshold condition requires thresholdValue and comparisonOperator"
            });
        }

        if (conditionType === 'state_change' && !targetState) {
            return res.status(400).json({
                error: "State change condition requires targetState"
            });
        }

        // Validate duration if provided (DRY principle - use centralized validation)
        if (stateDuration) {
            const durationValidation = validateDuration(stateDuration, stateDurationUnit);
            if (!durationValidation.valid) {
                return res.status(400).json({
                    error: `Invalid duration: ${durationValidation.error}`
                });
            }
        }

        // Validate escalation configuration if enabled
        if (enableEscalation) {
            // Escalation requires email notifications
            if (!sendEmail) {
                return res.status(400).json({
                    error: "Escalation requires email notifications to be enabled"
                });
            }

            // Validate escalation delay
            if (!escalationDelay || escalationDelay <= 0) {
                return res.status(400).json({
                    error: "Escalation delay must be greater than 0"
                });
            }

            const escalationValidation = validateDuration(escalationDelay, escalationDelayUnit || 'hours');
            if (!escalationValidation.valid) {
                return res.status(400).json({
                    error: `Invalid escalation delay: ${escalationValidation.error}`
                });
            }

            // Validate escalation users
            if (!escalationUserIds || !Array.isArray(escalationUserIds) || escalationUserIds.length === 0) {
                return res.status(400).json({
                    error: "Escalation requires at least one escalation user"
                });
            }

            // Validate max escalation level
            if (maxEscalationLevel && (maxEscalationLevel < 1 || maxEscalationLevel > escalationUserIds.length)) {
                return res.status(400).json({
                    error: `Max escalation level must be between 1 and ${escalationUserIds.length} (number of escalation users)`
                });
            }

            // Verify all escalation users exist
            const escalationUsers = await User.findAll({
                where: { id: { [Op.in]: escalationUserIds } },
                attributes: ['id', 'email']
            });

            if (escalationUsers.length !== escalationUserIds.length) {
                return res.status(404).json({
                    error: "One or more escalation users not found"
                });
            }

            // Verify all escalation users have email addresses
            const usersWithoutEmail = escalationUsers.filter(u => !u.email);
            if (usersWithoutEmail.length > 0) {
                return res.status(400).json({
                    error: `Escalation users must have email addresses (User IDs without email: ${usersWithoutEmail.map(u => u.id).join(', ')})`
                });
            }
        }

        // Verify tag exists
        const tag = await Tags.findByPk(tagId);
        if (!tag) {
            return res.status(404).json({ error: `Tag with ID ${tagId} not found` });
        }

        // Create event
        const event = await NotificationEvent.create({
            eventName,
            description,
            tagId,
            conditionType,
            thresholdValue: conditionType === 'threshold' ? thresholdValue : null,
            comparisonOperator: conditionType === 'threshold' ? comparisonOperator : null,
            targetState: conditionType === 'state_change' ? targetState : null,
            stateDuration: (conditionType === 'state_change' && stateDuration) ? stateDuration : null,
            stateDurationUnit: (conditionType === 'state_change' && stateDuration) ? stateDurationUnit : null,
            selectedUsers: selectedUsers || [],
            filterByLocationId: filterByLocationId || null,
            filterByLineId: filterByLineId || null,
            sendEmail: sendEmail !== undefined ? sendEmail : true,
            sendInApp: sendInApp !== undefined ? sendInApp : true,
            cooldownMinutes: cooldownMinutes || 5,
            isActive: true,
            createdBy: req.body.createdBy || 1, // Should come from authenticated user
            // Escalation fields
            enableEscalation: enableEscalation || false,
            escalationDelay: enableEscalation ? escalationDelay : null,
            escalationDelayUnit: enableEscalation ? (escalationDelayUnit || 'hours') : null,
            escalationUserIds: enableEscalation ? escalationUserIds : null,
            maxEscalationLevel: enableEscalation ? (maxEscalationLevel || escalationUserIds?.length || 1) : 1
        });

        res.status(201).json({
            message: "Notification event created successfully",
            event
        });

    } catch (error) {
        console.error("Error creating notification event:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get all notification events (with pagination)
 */
exports.getAllEvents = async (req, res) => {
    try {
        const { page = 0, limit = 10, isActive } = req.query;
        const offset = parseInt(page) * parseInt(limit);

        const whereClause = {};
        if (isActive !== undefined) {
            whereClause.isActive = isActive === 'true';
        }

        const { count, rows } = await NotificationEvent.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Tags,
                    as: 'tag',
                    attributes: ['id', 'name', 'ref', 'taggableType']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email']
                },
                {
                    model: Location,
                    as: 'filterLocation',
                    required: false,
                    attributes: ['id', 'name']
                },
                {
                    model: Line,
                    as: 'filterLine',
                    required: false,
                    attributes: ['id', 'name']
                }
            ],
            limit: parseInt(limit),
            offset: offset,
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            data: rows,
            total: count,
            pages: Math.ceil(count / parseInt(limit)),
            currentPage: parseInt(page)
        });

    } catch (error) {
        console.error("Error fetching notification events:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get a single notification event by ID
 */
exports.getEventById = async (req, res) => {
    try {
        const { id } = req.params;

        const event = await NotificationEvent.findByPk(id, {
            include: [
                {
                    model: Tags,
                    as: 'tag',
                    attributes: ['id', 'name', 'ref', 'taggableType', 'taggableId']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email']
                },
                {
                    model: Location,
                    as: 'filterLocation',
                    required: false,
                    attributes: ['id', 'name']
                },
                {
                    model: Line,
                    as: 'filterLine',
                    required: false,
                    attributes: ['id', 'name']
                }
            ]
        });

        if (!event) {
            return res.status(404).json({ error: "Notification event not found" });
        }

        res.status(200).json(event);

    } catch (error) {
        console.error("Error fetching notification event:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Update a notification event
 */
exports.updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const event = await NotificationEvent.findByPk(id);
        if (!event) {
            return res.status(404).json({ error: "Notification event not found" });
        }

        // Validate condition-specific fields if being updated
        if (updateData.conditionType === 'threshold' && (!updateData.thresholdValue || !updateData.comparisonOperator)) {
            return res.status(400).json({
                error: "Threshold condition requires thresholdValue and comparisonOperator"
            });
        }

        if (updateData.conditionType === 'state_change' && !updateData.targetState) {
            return res.status(400).json({
                error: "State change condition requires targetState"
            });
        }

        // Validate duration if provided (DRY principle - use centralized validation)
        if (updateData.stateDuration) {
            const durationValidation = validateDuration(updateData.stateDuration, updateData.stateDurationUnit);
            if (!durationValidation.valid) {
                return res.status(400).json({
                    error: `Invalid duration: ${durationValidation.error}`
                });
            }
        }

        // Clean up unused fields based on condition type
        if (updateData.conditionType === 'value_change') {
            // Value change doesn't use threshold or state fields
            updateData.thresholdValue = null;
            updateData.comparisonOperator = null;
            updateData.targetState = null;
            updateData.stateDuration = null;
            updateData.stateDurationUnit = null;
        } else if (updateData.conditionType === 'threshold') {
            // Threshold doesn't use state field
            updateData.targetState = null;
            updateData.stateDuration = null;
            updateData.stateDurationUnit = null;
        } else if (updateData.conditionType === 'state_change') {
            // State change doesn't use threshold fields
            updateData.thresholdValue = null;
            updateData.comparisonOperator = null;
            // Keep duration fields if provided, otherwise set to null
            if (!updateData.stateDuration) {
                updateData.stateDuration = null;
                updateData.stateDurationUnit = null;
            }
        }

        // Update event
        await event.update(updateData);

        // Fetch updated event with associations
        const updatedEvent = await NotificationEvent.findByPk(id, {
            include: [
                {
                    model: Tags,
                    as: 'tag',
                    attributes: ['id', 'name', 'ref']
                },
                {
                    model: User,
                    as: 'creator',
                    attributes: ['id', 'username', 'email']
                },
                {
                    model: Location,
                    as: 'filterLocation',
                    required: false,
                    attributes: ['id', 'name']
                },
                {
                    model: Line,
                    as: 'filterLine',
                    required: false,
                    attributes: ['id', 'name']
                }
            ]
        });

        res.status(200).json({
            message: "Notification event updated successfully",
            event: updatedEvent
        });

    } catch (error) {
        console.error("Error updating notification event:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Delete a notification event
 */
exports.deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;

        const event = await NotificationEvent.findByPk(id);
        if (!event) {
            return res.status(404).json({ error: "Notification event not found" });
        }

        await event.destroy();

        res.status(200).json({
            message: "Notification event deleted successfully"
        });

    } catch (error) {
        console.error("Error deleting notification event:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Toggle event active status
 */
exports.toggleEventStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const event = await NotificationEvent.findByPk(id);
        if (!event) {
            return res.status(404).json({ error: "Notification event not found" });
        }

        await event.update({ isActive: !event.isActive });

        res.status(200).json({
            message: `Event ${event.isActive ? 'activated' : 'deactivated'} successfully`,
            isActive: event.isActive
        });

    } catch (error) {
        console.error("Error toggling event status:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get users filtered by location and/or line
 */
exports.getUsersByLocationAndLine = async (req, res) => {
    try {
        const { locationId, lineId } = req.query;

        let whereClause = {};

        if (locationId) {
            whereClause.locationId = locationId;
        } else if (lineId) {
            // Get location from line
            const line = await Line.findByPk(lineId, {
                include: [{
                    model: Location,
                    as: 'location',
                    attributes: ['id']
                }]
            });

            if (line && line.location) {
                whereClause.locationId = line.location.id;
            }
        }

        const users = await User.findAll({
            where: whereClause,
            attributes: ['id', 'username', 'email', 'firstName', 'lastName'],
            include: [
                {
                    model: Location,
                    as: 'location',
                    required: false,
                    attributes: ['id', 'name']
                }
            ],
            order: [['username', 'ASC']]
        });

        res.status(200).json(users);

    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = exports;

