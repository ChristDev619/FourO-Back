const { UserReportOrder } = require("../dbInit");
const logger = require("../utils/logger");

exports.updateUserReportOrders = async (req, res) => {
    try {
        const { userId, reports } = req.body;

        if (!userId || !Array.isArray(reports)) {
            return res.status(400).json({ message: "Invalid payload structure." });
        }

        await UserReportOrder.destroy({ where: { userId } });

        const dataToInsert = reports.map((r, index) => ({
            userId,
            reportId: r.reportId,
            sortOrder: index,
        }));

        await UserReportOrder.bulkCreate(dataToInsert);

        res.status(200).json({ message: "User report order updated successfully." });
    } catch (error) {
        logger.error("Error updating report order", { error: error.message, stack: error.stack });
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};