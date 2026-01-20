const { Line, Machine } = require("../dbInit");

const getMachinesByLineId = async (req, res) => {
  try {
    const { lineId } = req.params;

    if (!lineId) {
      return res.status(400).json({ message: "Line ID is required" });
    }

    // Fetch the line and include associated machines
    const line = await Line.findByPk(lineId, {
      include: [
        {
          model: Machine,
          as: "machines",
          through: { attributes: [] }, // Exclude the join table attributes
        },
      ],
    });

    if (!line) {
      return res.status(404).json({ message: "Line not found" });
    }

    return res.status(200).json({ machines: line.machines });
  } catch (error) {
    console.error("Error fetching machines by line ID:", error);
    return res.status(500).json({ message: "An error occurred", error });
  }
};

module.exports = { getMachinesByLineId };
