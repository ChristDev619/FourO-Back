const { Program, Job, sequelize } = require('../../dbInit');
const logger = require('../logger');

/**
 * OrphanedProgramsService
 * Service to identify programs that have no associated jobs
 */
class OrphanedProgramsService {
  /**
   * Find all orphaned programs (programs with no jobs)
   * @returns {Promise<Array>} Array of orphaned program objects
   */
  async findOrphanedPrograms() {
    try {
      // Use raw SQL query for reliable LEFT JOIN with IS NULL check
      const [results] = await sequelize.query(`
        SELECT p.id, p.number, p.programName, p.description, p.startDate, p.endDate, p.lineId, p.createdAt
        FROM Programs p
        LEFT JOIN Jobs j ON j.programId = p.id
        WHERE j.id IS NULL
        ORDER BY p.createdAt DESC
      `);

      // Convert raw results to Program instances for consistency
      const orphanedPrograms = await Program.findAll({
        where: {
          id: results.length > 0 ? results.map((r) => r.id) : [-1], // Use -1 to return empty if no results
        },
        attributes: ['id', 'number', 'programName', 'description', 'startDate', 'endDate', 'lineId', 'createdAt'],
        order: [['createdAt', 'DESC']],
      });

      logger.info('Orphaned programs check completed', {
        count: orphanedPrograms.length,
      });

      return orphanedPrograms;
    } catch (error) {
      logger.error('Error finding orphaned programs', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get orphaned programs as a formatted summary
   * @returns {Promise<Object>} Summary object with count, IDs, and details
   */
  async getOrphanedProgramsSummary() {
    try {
      const orphanedPrograms = await this.findOrphanedPrograms();

      const programIds = orphanedPrograms.map((p) => p.id).join(', ');
      const programDetails = orphanedPrograms.map((p) => ({
        id: p.id,
        number: p.number,
        programName: p.programName,
        description: p.description || 'N/A',
        startDate: p.startDate ? new Date(p.startDate).toLocaleDateString() : 'N/A',
        endDate: p.endDate ? new Date(p.endDate).toLocaleDateString() : 'N/A',
        lineId: p.lineId,
        createdAt: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A',
      }));

      return {
        count: orphanedPrograms.length,
        programIds,
        programs: programDetails,
      };
    } catch (error) {
      logger.error('Error getting orphaned programs summary', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}

module.exports = new OrphanedProgramsService();

