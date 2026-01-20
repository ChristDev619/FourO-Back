-- =====================================================
-- Alter DemandForecasts Table if it Already Exists
-- =====================================================
-- Use this if DemandForecasts table exists but needs column updates
-- =====================================================

-- Check current structure first
DESCRIBE `DemandForecasts`;

-- Add missing columns (only if they don't exist)
-- Note: MySQL doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- So check manually or use this script carefully

-- Add forecastData column if missing
SET @col_exists = (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'DemandForecasts' 
    AND COLUMN_NAME = 'forecastData'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `DemandForecasts` ADD COLUMN `forecastData` JSON NOT NULL AFTER `description`',
  'SELECT "Column forecastData already exists" AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add userId column if missing
SET @col_exists = (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'DemandForecasts' 
    AND COLUMN_NAME = 'userId'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `DemandForecasts` ADD COLUMN `userId` INT NULL AFTER `forecastData`',
  'SELECT "Column userId already exists" AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add isActive column if missing
SET @col_exists = (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'DemandForecasts' 
    AND COLUMN_NAME = 'isActive'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `DemandForecasts` ADD COLUMN `isActive` TINYINT(1) NOT NULL DEFAULT 1 AFTER `userId`',
  'SELECT "Column isActive already exists" AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add createdAt column if missing
SET @col_exists = (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'DemandForecasts' 
    AND COLUMN_NAME = 'createdAt'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `DemandForecasts` ADD COLUMN `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `isActive`',
  'SELECT "Column createdAt already exists" AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add updatedAt column if missing
SET @col_exists = (
  SELECT COUNT(*) 
  FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'DemandForecasts' 
    AND COLUMN_NAME = 'updatedAt'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `DemandForecasts` ADD COLUMN `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `createdAt`',
  'SELECT "Column updatedAt already exists" AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add indexes if missing
CREATE INDEX IF NOT EXISTS `idx_demand_forecasts_userId` ON `DemandForecasts` (`userId`);
CREATE INDEX IF NOT EXISTS `idx_demand_forecasts_isActive` ON `DemandForecasts` (`isActive`);
CREATE INDEX IF NOT EXISTS `idx_demand_forecasts_createdAt` ON `DemandForecasts` (`createdAt`);

-- Add foreign key if missing (drop first if exists with different name)
SET @fk_exists = (
  SELECT COUNT(*) 
  FROM information_schema.KEY_COLUMN_USAGE 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'DemandForecasts' 
    AND COLUMN_NAME = 'userId' 
    AND REFERENCED_TABLE_NAME = 'Users'
);

SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE `DemandForecasts` ADD CONSTRAINT `fk_demand_forecasts_userId` FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT "Foreign key already exists" AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify final structure
DESCRIBE `DemandForecasts`;

