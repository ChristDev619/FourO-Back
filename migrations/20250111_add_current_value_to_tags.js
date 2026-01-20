'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add currentValue and lastValueUpdatedAt to Tags table
    await queryInterface.addColumn('Tags', 'currentValue', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Current/latest value of the tag for quick access'
    });

    await queryInterface.addColumn('Tags', 'lastValueUpdatedAt', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Timestamp when currentValue was last updated'
    });

    // Add index for faster lookups if needed
    await queryInterface.addIndex('Tags', ['currentValue'], {
      name: 'idx_tags_current_value'
    });

    console.log('✅ Added currentValue and lastValueUpdatedAt columns to Tags table');
  },

  down: async (queryInterface, Sequelize) => {
    // Remove index first
    await queryInterface.removeIndex('Tags', 'idx_tags_current_value');
    
    // Remove columns
    await queryInterface.removeColumn('Tags', 'lastValueUpdatedAt');
    await queryInterface.removeColumn('Tags', 'currentValue');
    
    console.log('✅ Removed currentValue and lastValueUpdatedAt columns from Tags table');
  }
};

