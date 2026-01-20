-- =====================================================
-- Check Planning Tables in Azure Database
-- =====================================================
-- Run this to check what Planning tables exist and their structure
-- =====================================================

-- Check if Planning tables exist
SELECT 
  TABLE_NAME,
  TABLE_ROWS,
  CREATE_TIME,
  UPDATE_TIME,
  TABLE_COLLATION,
  ENGINE
FROM 
  information_schema.TABLES 
WHERE 
  TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
ORDER BY TABLE_NAME;

-- Check SeasonalityData structure (if exists)
SELECT 
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_TYPE,
  COLUMN_KEY,
  EXTRA
FROM 
  information_schema.COLUMNS 
WHERE 
  TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'SeasonalityData'
ORDER BY ORDINAL_POSITION;

-- Check DemandForecasts structure (if exists)
SELECT 
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_TYPE,
  COLUMN_KEY,
  EXTRA
FROM 
  information_schema.COLUMNS 
WHERE 
  TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'DemandForecasts'
ORDER BY ORDINAL_POSITION;

-- Check MonthlyForecasts structure (if exists)
SELECT 
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_TYPE,
  COLUMN_KEY,
  EXTRA
FROM 
  information_schema.COLUMNS 
WHERE 
  TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'MonthlyForecasts'
ORDER BY ORDINAL_POSITION;

-- Check foreign keys
SELECT 
  CONSTRAINT_NAME,
  TABLE_NAME,
  COLUMN_NAME,
  REFERENCED_TABLE_NAME,
  REFERENCED_COLUMN_NAME
FROM 
  information_schema.KEY_COLUMN_USAGE
WHERE 
  TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
  AND REFERENCED_TABLE_NAME IS NOT NULL;

-- Check indexes
SELECT 
  TABLE_NAME,
  INDEX_NAME,
  COLUMN_NAME,
  NON_UNIQUE,
  SEQ_IN_INDEX
FROM 
  information_schema.STATISTICS
WHERE 
  TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

