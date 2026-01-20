/**
 * Alarm Utility Functions
 * 
 * This module provides reusable functions for alarm-related operations,
 * following SOLID principles to avoid code duplication and improve maintainability.
 */

/**
 * Generates SQL condition for matching alarm codes with flexible leading zero handling
 * 
 * This function creates a SQL condition that handles alarm codes with or without leading zeros.
 * It matches alarm codes regardless of whether they come as "50", "050", or "0050".
 * 
 * @param {string} alarmCodeColumn - The column name for alarm code (e.g., "AA.alarmCode")
 * @param {string} alarmNameColumn - The column name for alarm name (e.g., "A.name")
 * @param {string} machineIdColumn - The column name for machine ID (e.g., "AA.machineId")
 * @param {string} alarmMachineIdColumn - The alarm table machine ID column (e.g., "A.machineId")
 * @returns {string} SQL condition for JOIN or WHERE clause
 * 
 * @example
 * // For JOIN conditions
 * const joinCondition = generateAlarmMatchCondition("AA.alarmCode", "A.name", "AA.machineId", "A.machineId");
 * const sql = `LEFT JOIN Alarms A ON (${joinCondition})`;
 * 
 * // For WHERE conditions in subqueries
 * const whereCondition = generateAlarmMatchCondition("AA.alarmCode", "A.name", "AA.machineId", "A.machineId");
 * const sql = `SELECT A.description FROM Alarms A WHERE (${whereCondition}) LIMIT 1`;
 */
const generateAlarmMatchCondition = (alarmCodeColumn, alarmNameColumn, machineIdColumn, alarmMachineIdColumn) => {
  return `(
    ${alarmCodeColumn} = ${alarmNameColumn} OR 
    ${alarmCodeColumn} = TRIM(LEADING '0' FROM ${alarmNameColumn}) OR 
    TRIM(LEADING '0' FROM ${alarmCodeColumn}) = ${alarmNameColumn} OR
    TRIM(LEADING '0' FROM ${alarmCodeColumn}) = TRIM(LEADING '0' FROM ${alarmNameColumn})
  ) AND ${machineIdColumn} = ${alarmMachineIdColumn}`;
};

/**
 * Generates SQL condition for alarm matching in JOIN statements
 * Optimized for common JOIN patterns in alarm queries
 * 
 * @param {string} aggregationAlias - Alias for AlarmAggregations table (e.g., "AA")
 * @param {string} alarmAlias - Alias for Alarms table (e.g., "A")
 * @returns {string} Complete JOIN condition
 * 
 * @example
 * const joinCondition = generateAlarmJoinCondition("AA", "A");
 * const sql = `LEFT JOIN Alarms A ON (${joinCondition})`;
 */
const generateAlarmJoinCondition = (aggregationAlias = "AA", alarmAlias = "A") => {
  return generateAlarmMatchCondition(
    `${aggregationAlias}.alarmCode`,
    `${alarmAlias}.name`,
    `${aggregationAlias}.machineId`,
    `${alarmAlias}.machineId`
  );
};

/**
 * Generates SQL condition for alarm matching in WHERE clauses (subqueries)
 * Optimized for subquery patterns when fetching alarm descriptions
 * 
 * @param {string} aggregationAlias - Alias for AlarmAggregations table (e.g., "AA")
 * @param {string} alarmAlias - Alias for Alarms table (e.g., "A")
 * @returns {string} Complete WHERE condition for subqueries
 * 
 * @example
 * const whereCondition = generateAlarmWhereCondition("AA", "A");
 * const sql = `SELECT A.description FROM Alarms A WHERE (${whereCondition}) LIMIT 1`;
 */
const generateAlarmWhereCondition = (aggregationAlias = "AA", alarmAlias = "A") => {
  return `(
    ${alarmAlias}.name = ${aggregationAlias}.alarmCode OR 
    ${alarmAlias}.name = TRIM(LEADING '0' FROM ${aggregationAlias}.alarmCode) OR 
    TRIM(LEADING '0' FROM ${alarmAlias}.name) = ${aggregationAlias}.alarmCode OR
    TRIM(LEADING '0' FROM ${alarmAlias}.name) = TRIM(LEADING '0' FROM ${aggregationAlias}.alarmCode)
  )`;
};

/**
 * Normalizes alarm code by removing leading zeros
 * Useful for consistent comparison in JavaScript code
 * 
 * @param {string} alarmCode - The alarm code to normalize
 * @returns {string} Normalized alarm code
 * 
 * @example
 * normalizeAlarmCode("0050") // returns "50"
 * normalizeAlarmCode("50") // returns "50"
 * normalizeAlarmCode("00500") // returns "500"
 */
const normalizeAlarmCode = (alarmCode) => {
  if (!alarmCode || typeof alarmCode !== 'string') {
    return alarmCode;
  }
  return alarmCode.replace(/^0+/, '') || '0'; // Handle case where all digits are zeros
};

module.exports = {
  generateAlarmMatchCondition,
  generateAlarmJoinCondition,
  generateAlarmWhereCondition,
  normalizeAlarmCode
};
