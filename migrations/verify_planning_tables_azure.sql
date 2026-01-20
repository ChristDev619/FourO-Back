-- =====================================================
-- Verify Planning Tables Setup in Azure
-- =====================================================
-- Run this to verify all tables are correctly set up
-- =====================================================

USE flexibleserverdb;

-- 1. Verify all tables exist
SELECT 
  TABLE_NAME,
  TABLE_ROWS,
  CREATE_TIME,
  TABLE_COLLATION,
  ENGINE
FROM 
  information_schema.TABLES 
WHERE 
  TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
ORDER BY TABLE_NAME;

-- 2. Check foreign keys are properly set up
SELECT 
  CONSTRAINT_NAME,
  TABLE_NAME,
  COLUMN_NAME,
  REFERENCED_TABLE_NAME,
  REFERENCED_COLUMN_NAME,
  UPDATE_RULE,
  DELETE_RULE
FROM 
  information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc 
    ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
    AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
WHERE 
  kcu.TABLE_SCHEMA = DATABASE()
  AND kcu.TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

-- 3. Check indexes are created
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

-- 4. Verify JSON columns exist and are correct type
SELECT 
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM 
  information_schema.COLUMNS
WHERE 
  TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
  AND (COLUMN_NAME = 'seasonalityData' OR COLUMN_NAME = 'forecastData')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 5. Check if DemandForecasts needs any column updates
-- Compare isActive column type with others
SELECT 
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM 
  information_schema.COLUMNS
WHERE 
  TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
  AND COLUMN_NAME = 'isActive'
ORDER BY TABLE_NAME;

-- 6. Optional: Make DemandForecasts.isActive consistent (tinyint(1) instead of tinyint)
-- Uncomment below if you want to update it for consistency (not required, both work the same)
-- ALTER TABLE `DemandForecasts` 
--   MODIFY COLUMN `isActive` TINYINT(1) NOT NULL DEFAULT 1;

