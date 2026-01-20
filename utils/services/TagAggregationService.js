const { Op, sequelize } = require("../../dbInit");
const dayjs = require("dayjs");

class TagAggregationService {
  /**
   * Get hourly aggregates directly from TagValues
   */
  async getHourlyAggregates(tagId, startDate, endDate) {
    return await sequelize.query(`
      SELECT 
        DATE(createdAt) as date,
        HOUR(createdAt) as hour,
        MIN(CAST(value AS DECIMAL(10,2))) as min_Value,
        MAX(CAST(value AS DECIMAL(10,2))) as max_Value,
        MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
      FROM TagValues 
      WHERE tagId = :tagId 
        AND createdAt BETWEEN :startDate AND :endDate
      GROUP BY DATE(createdAt), HOUR(createdAt)
      ORDER BY date ASC, hour ASC
    `, {
      replacements: { tagId, startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });
  }

  /**
   * Get daily aggregates directly from TagValues
   */
  async getDailyAggregates(tagId, startDate, endDate) {
    return await sequelize.query(`
      SELECT 
        DATE(createdAt) as date,
        MIN(CAST(value AS DECIMAL(10,2))) as min_Value,
        MAX(CAST(value AS DECIMAL(10,2))) as max_Value,
        MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
      FROM TagValues 
      WHERE tagId = :tagId 
        AND createdAt BETWEEN :startDate AND :endDate
      GROUP BY DATE(createdAt)
      ORDER BY date ASC
    `, {
      replacements: { tagId, startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });
  }

  /**
   * Get weekly aggregates directly from TagValues
   */
  async getWeeklyAggregates(tagId, startDate, endDate) {
    return await sequelize.query(`
      SELECT 
        DATE(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY)) as weekStart,
        DATE(DATE_ADD(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), INTERVAL 6 DAY)) as weekEnd,
        MIN(CAST(value AS DECIMAL(10,2))) as min_Value,
        MAX(CAST(value AS DECIMAL(10,2))) as max_Value,
        MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
      FROM TagValues 
      WHERE tagId = :tagId 
        AND createdAt BETWEEN :startDate AND :endDate
      GROUP BY YEARWEEK(createdAt)
      ORDER BY weekStart ASC
    `, {
      replacements: { tagId, startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });
  }

  /**
   * Get monthly aggregates directly from TagValues
   */
  async getMonthlyAggregates(tagId, startDate, endDate) {
    return await sequelize.query(`
      SELECT 
        DATE_FORMAT(createdAt, '%Y-%m-01') as monthStart,
        LAST_DAY(createdAt) as monthEnd,
        MIN(CAST(value AS DECIMAL(10,2))) as min_Value,
        MAX(CAST(value AS DECIMAL(10,2))) as max_Value,
        MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
      FROM TagValues 
      WHERE tagId = :tagId 
        AND createdAt BETWEEN :startDate AND :endDate
      GROUP BY YEAR(createdAt), MONTH(createdAt)
      ORDER BY monthStart ASC
    `, {
      replacements: { tagId, startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });
  }

  /**
   * Get multiple tag aggregates for comparison
   */
  async getMultipleTagAggregates(tagIds, startDate, endDate, aggregationType = 'daily') {
    const tagIdsStr = tagIds.join(',');
    
    let groupBy, dateField;
    switch (aggregationType) {
      case 'hourly':
        groupBy = 'DATE(createdAt), HOUR(createdAt)';
        dateField = 'DATE(createdAt) as date, HOUR(createdAt) as hour';
        break;
      case 'weekly':
        groupBy = 'YEARWEEK(createdAt)';
        dateField = 'DATE(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY)) as weekStart, DATE(DATE_ADD(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), INTERVAL 6 DAY)) as weekEnd';
        break;
      case 'monthly':
        groupBy = 'YEAR(createdAt), MONTH(createdAt)';
        dateField = 'DATE_FORMAT(createdAt, "%Y-%m-01") as monthStart, LAST_DAY(createdAt) as monthEnd';
        break;
      default: // daily
        groupBy = 'DATE(createdAt)';
        dateField = 'DATE(createdAt) as date';
    }

    return await sequelize.query(`
      SELECT 
        tagId,
        ${dateField},
        MIN(CAST(value AS DECIMAL(10,2))) as min_Value,
        MAX(CAST(value AS DECIMAL(10,2))) as max_Value,
        MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
      FROM TagValues 
      WHERE tagId IN (${tagIdsStr})
        AND createdAt BETWEEN :startDate AND :endDate
      GROUP BY tagId, ${groupBy}
      ORDER BY tagId, ${aggregationType === 'hourly' ? 'date ASC, hour ASC' : 'date ASC'}
    `, {
      replacements: { startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });
  }

  /**
   * Get latest value for a tag
   */
  async getLatestValue(tagId) {
    return await sequelize.query(`
      SELECT value, createdAt
      FROM TagValues 
      WHERE tagId = :tagId 
      ORDER BY createdAt DESC 
      LIMIT 1
    `, {
      replacements: { tagId },
      type: sequelize.QueryTypes.SELECT
    });
  }

  /**
   * Get value difference between start and end of period
   */
  async getPeriodDifference(tagId, startDate, endDate) {
    const result = await sequelize.query(`
      SELECT 
        (SELECT CAST(value AS DECIMAL(10,2)) 
         FROM TagValues 
         WHERE tagId = :tagId 
           AND createdAt >= :startDate 
         ORDER BY createdAt ASC 
         LIMIT 1) as firstValue,
        (SELECT CAST(value AS DECIMAL(10,2)) 
         FROM TagValues 
         WHERE tagId = :tagId 
           AND createdAt <= :endDate 
         ORDER BY createdAt DESC 
         LIMIT 1) as lastValue
    `, {
      replacements: { tagId, startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });

    if (result.length > 0 && result[0].firstValue !== null && result[0].lastValue !== null) {
      return result[0].lastValue - result[0].firstValue;
    }
    return 0;
  }

  /**
   * Get heatmap data (hourly aggregation for multiple tags)
   */
  async getHeatmapData(tagIds, startDate, endDate) {
    return await sequelize.query(`
      SELECT 
        CONCAT(date, ' ', LPAD(hour, 2, '0')) as hourOfDay,
        SUM(diffValue) as totalDiffValue
      FROM (
        SELECT 
          DATE(createdAt) as date,
          HOUR(createdAt) as hour,
          tagId,
          MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
        FROM TagValues 
        WHERE tagId IN (${tagIds.join(',')})
          AND createdAt BETWEEN :startDate AND :endDate
        GROUP BY tagId, DATE(createdAt), HOUR(createdAt)
      ) as hourly_aggregates
      GROUP BY date, hour
      ORDER BY hourOfDay ASC
    `, {
      replacements: { startDate, endDate },
      type: sequelize.QueryTypes.SELECT
    });
  }
}

module.exports = TagAggregationService; 