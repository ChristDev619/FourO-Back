'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add composite index for tagId and createdAt (most common query pattern)
    await queryInterface.addIndex('TagValues', ['tagId', 'createdAt'], {
      name: 'idx_tagvalues_tagid_createdat'
    });

    // Add index for createdAt alone (for date range queries)
    await queryInterface.addIndex('TagValues', ['createdAt'], {
      name: 'idx_tagvalues_createdat'
    });

    // Add index for tagId alone (for tag-specific queries)
    await queryInterface.addIndex('TagValues', ['tagId'], {
      name: 'idx_tagvalues_tagid'
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Remove indexes in reverse order
    await queryInterface.removeIndex('TagValues', 'idx_tagvalues_tagid');
    await queryInterface.removeIndex('TagValues', 'idx_tagvalues_createdat');
    await queryInterface.removeIndex('TagValues', 'idx_tagvalues_tagid_createdat');
  }
}; 