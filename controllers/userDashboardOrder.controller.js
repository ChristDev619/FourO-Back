const { UserDashboardOrder } = require("../dbInit");
const logger = require("../utils/logger");

exports.updateUserDashboardOrders = async (req, res) => {
    try {
        const { userId, dashboards } = req.body;

        if (!userId || !Array.isArray(dashboards)) {
            return res.status(400).json({ message: "Invalid payload structure." });
        }

        // Remove old orders
        await UserDashboardOrder.destroy({
            where: { userId }
        });

        // Insert new ones
        const dataToInsert = dashboards.map((d, index) => ({
            userId,
            dashboardId: d.dashboardId,
            sortOrder: index,
        }));

        await UserDashboardOrder.bulkCreate(dataToInsert);

        res.status(200).json({ message: "User dashboard order updated successfully." });
    } catch (error) {
        logger.error("Error updating dashboard order", { error: error.message, stack: error.stack });
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};
