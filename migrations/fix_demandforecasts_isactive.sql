-- =====================================================
-- Optional: Make DemandForecasts.isActive Consistent
-- =====================================================
-- This makes DemandForecasts.isActive match the other tables
-- (tinyint(1) instead of tinyint)
-- This is OPTIONAL - both work the same functionally
-- =====================================================

USE flexibleserverdb;

-- Check current type
SELECT 
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE
FROM 
  information_schema.COLUMNS
WHERE 
  TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'DemandForecasts'
  AND COLUMN_NAME = 'isActive';

-- Update to match other tables (optional)
ALTER TABLE `DemandForecasts` 
  MODIFY COLUMN `isActive` TINYINT(1) NOT NULL DEFAULT 1;

-- Verify change
SELECT 
  TABLE_NAME,
  COLUMN_NAME,
  COLUMN_TYPE
FROM 
  information_schema.COLUMNS
WHERE 
  TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'DemandForecasts'
  AND COLUMN_NAME = 'isActive';

