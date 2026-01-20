const { Dashboard, Level } = require("../dbInit");

module.exports = {
  // Create a new dashboard
  createDashboard: async (req, res) => {
    try {
      const dashboard = await Dashboard.create(req.body);
      res.status(201).json(dashboard);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get all dashboards
  getAllDashboards: async (req, res) => {
    try {
      const dashboards = await Dashboard.findAll();
      res.status(200).json(dashboards);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get dashboards by user ID
  getDashboardsByUserId: async (req, res) => {
    try {
      const { userId } = req.params;
      const dashboards = await Dashboard.findAll({ 
        where: { userId } 
      });
      res.status(200).json(dashboards);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get dashboard by ID
  getDashboardById: async (req, res) => {
    try {
      const dashboard = await Dashboard.findByPk(req.params.id);
      if (!dashboard) {
        return res.status(404).json({ message: "Dashboard not found" });
      }
      res.status(200).json(dashboard);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Update dashboard by ID
  updateDashboard: async (req, res) => {
    try {
      const [updated] = await Dashboard.update(req.body, { 
        where: { id: req.params.id } 
      });
      if (!updated) {
        return res.status(404).json({ message: "Dashboard not found" });
      }
      const updatedDashboard = await Dashboard.findByPk(req.params.id);
      res.status(200).json(updatedDashboard);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Delete dashboard by ID
  deleteDashboard: async (req, res) => {
    try {
      const deleted = await Dashboard.destroy({ 
        where: { id: req.params.id } 
      });
      if (!deleted) {
        return res.status(404).json({ message: "Dashboard not found" });
      }
      res.status(200).json({ message: "Dashboard deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Toggle dashboard favorite status
  toggleDashboardFavorite: async (req, res) => {
    try {
      const { id } = req.params;
      const dashboard = await Dashboard.findByPk(id);
      
      if (!dashboard) {
        return res.status(404).json({ message: "Dashboard not found" });
      }
      
      const newFavorite = !dashboard.isFavorite;
      await dashboard.update({ isFavorite: newFavorite });
      
      res.status(200).json({ 
        isFavorite: newFavorite,
        message: `Dashboard ${newFavorite ? 'added to' : 'removed from'} favorites`
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get dashboards by access level ID
  getDashboardsByLevelId: async (req, res) => {
    try {
      const { levelId } = req.params;
      
      // Get the access level to check allowed dashboards
      const level = await Level.findByPk(levelId);
      if (!level) {
        return res.status(404).json({ message: "Access level not found" });
      }

      // If no allowedDashboards specified, return empty array
      if (!level.allowedDashboards || level.allowedDashboards.length === 0) {
        return res.status(200).json([]);
      }

      // Get dashboards that are in the allowed list
      const dashboards = await Dashboard.findAll({
        where: {
          id: level.allowedDashboards
        },
        order: [['title', 'ASC']]
      });

      res.status(200).json(dashboards);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get all dashboards for access level management (admin use)
  getAllDashboardsForLevelManagement: async (req, res) => {
    try {
      const dashboards = await Dashboard.findAll({
        attributes: ['id', 'title', 'userId', 'createdAt'],
        order: [['title', 'ASC']]
      });
      res.status(200).json(dashboards);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};
