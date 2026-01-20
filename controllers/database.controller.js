const { sequelize } = require("../dbInit");
const logger = require("../utils/logger");

module.exports = {
  getTables: async (req, res) => {
    try {
      const queryInterface = sequelize.getQueryInterface();
      const tables = await queryInterface.showAllTables();

      // Format tables for MUI Autocomplete
      const formattedTables = tables.map((table) => {
        if (typeof table === "string") {
          return {
            label: table.charAt(0).toUpperCase() + table.slice(1),
            value: table,
          };
        } else if (table && table.name) {
          return {
            label: table.name.charAt(0).toUpperCase() + table.name.slice(1),
            value: table.name,
          };
        }
        return {
          label: "Unknown Table",
          value: table,
        };
      });

      res.json(formattedTables);
    } catch (error) {
      logger.error("Error getting database tables", { error: error.message, stack: error.stack });
      res.status(500).json({ error: error.message });
    }
  },
  getTableColumns: async (req, res) => {
    const { tableName } = req.params;
    try {
      const queryInterface = sequelize.getQueryInterface();
      const columns = await queryInterface.describeTable(tableName);

      // Format columns for MUI Autocomplete
      const formattedColumns = Object.keys(columns).map((column) => ({
        label: column.charAt(0).toUpperCase() + column.slice(1), // Capitalize the first letter
        value: column,
      }));

      res.json(formattedColumns);
    } catch (error) {
      logger.error("Error getting table columns", { tableName, error: error.message, stack: error.stack });
      res.status(500).json({ error: error.message });
    }
  },
};
