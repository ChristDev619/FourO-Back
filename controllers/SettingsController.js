const { Settings } = require("../dbInit");

exports.getCostPerManHour = async (req, res) => {
  try {
    // Settings table always has id = 1
    const settings = await Settings.findByPk(1);
    
    if (!settings) {
      // If no settings found, create default
      const defaultSettings = await Settings.create({
        id: 1,
        costPerManHour: 0,
      });
      return res.status(200).json({ costPerManHour: parseFloat(defaultSettings.costPerManHour) || 0 });
    }

    res.status(200).json({ costPerManHour: parseFloat(settings.costPerManHour) || 0 });
  } catch (error) {
    console.error("Error fetching cost per man hour:", error);
    res.status(500).json({ error: "Error retrieving cost per man hour" });
  }
};

exports.updateCostPerManHour = async (req, res) => {
  try {
    const { costPerManHour } = req.body;

    if (costPerManHour === undefined || costPerManHour === null) {
      return res.status(400).json({ error: "costPerManHour is required" });
    }

    const cost = parseFloat(costPerManHour);
    if (isNaN(cost) || cost < 0) {
      return res.status(400).json({ error: "costPerManHour must be a valid positive number" });
    }

    // Settings table always has id = 1
    const [updated] = await Settings.update(
      { costPerManHour: cost },
      { where: { id: 1 } }
    );

    if (updated === 0) {
      // If no row exists, create it
      await Settings.create({
        id: 1,
        costPerManHour: cost,
      });
    }

    const updatedSettings = await Settings.findByPk(1);
    res.status(200).json({ 
      costPerManHour: parseFloat(updatedSettings.costPerManHour) || 0,
      message: "Cost per man hour updated successfully"
    });
  } catch (error) {
    console.error("Error updating cost per man hour:", error);
    res.status(500).json({ error: "Error updating cost per man hour" });
  }
};

