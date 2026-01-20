-- =====================================================
-- Planning Feature Tables Setup for Azure Flexible Server
-- =====================================================
-- This script creates/updates all tables needed for Planning feature:
-- 1. SeasonalityData
-- 2. DemandForecasts (check if exists, alter if needed)
-- 3. MonthlyForecasts
-- =====================================================
-- Execute this script in your Azure MySQL Flexible Server database
-- =====================================================

-- =====================================================
-- 1. SEASONALITY DATA TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `SeasonalityData` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Seasonality Data',
  `description` TEXT NULL,
  `seasonalityData` JSON NOT NULL,
  `userId` INT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_seasonality_data_userId` (`userId`),
  INDEX `idx_seasonality_data_isActive` (`isActive`),
  INDEX `idx_seasonality_data_createdAt` (`createdAt`),
  CONSTRAINT `fk_seasonality_data_userId` 
    FOREIGN KEY (`userId`) 
    REFERENCES `Users` (`id`) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. DEMAND FORECASTS TABLE
-- =====================================================
-- Check if table exists and has correct structure
CREATE TABLE IF NOT EXISTS `DemandForecasts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Demand Forecast',
  `description` TEXT NULL,
  `forecastData` JSON NOT NULL,
  `userId` INT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_demand_forecasts_userId` (`userId`),
  INDEX `idx_demand_forecasts_isActive` (`isActive`),
  INDEX `idx_demand_forecasts_createdAt` (`createdAt`),
  CONSTRAINT `fk_demand_forecasts_userId` 
    FOREIGN KEY (`userId`) 
    REFERENCES `Users` (`id`) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- If table exists but missing columns, add them (run these separately if needed)
-- ALTER TABLE `DemandForecasts` 
--   ADD COLUMN IF NOT EXISTS `forecastData` JSON NOT NULL AFTER `description`,
--   ADD COLUMN IF NOT EXISTS `userId` INT NULL AFTER `forecastData`,
--   ADD COLUMN IF NOT EXISTS `isActive` TINYINT(1) NOT NULL DEFAULT 1 AFTER `userId`;

-- =====================================================
-- 3. MONTHLY FORECASTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS `MonthlyForecasts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Monthly Forecast',
  `description` TEXT NULL,
  `forecastData` JSON NOT NULL,
  `userId` INT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_monthly_forecasts_userId` (`userId`),
  INDEX `idx_monthly_forecasts_isActive` (`isActive`),
  INDEX `idx_monthly_forecasts_createdAt` (`createdAt`),
  CONSTRAINT `fk_monthly_forecasts_userId` 
    FOREIGN KEY (`userId`) 
    REFERENCES `Users` (`id`) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Check all Planning tables exist
SELECT 
  TABLE_NAME,
  TABLE_ROWS,
  CREATE_TIME,
  TABLE_COLLATION
FROM 
  information_schema.TABLES 
WHERE 
  TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts')
ORDER BY TABLE_NAME;

-- Check table structures
DESCRIBE `SeasonalityData`;
DESCRIBE `DemandForecasts`;
DESCRIBE `MonthlyForecasts`;

-- =====================================================
-- TABLE STRUCTURES SUMMARY
-- =====================================================
-- SeasonalityData:
--   - id (PK, INT, AUTO_INCREMENT)
--   - name (VARCHAR(255), DEFAULT 'Seasonality Data')
--   - description (TEXT, NULLABLE)
--   - seasonalityData (JSON, NOT NULL) - stores years and packagesByYear
--   - userId (INT, NULLABLE, FK to Users)
--   - isActive (TINYINT(1), DEFAULT 1)
--   - createdAt (DATETIME, AUTO)
--   - updatedAt (DATETIME, AUTO UPDATE)
--
-- DemandForecasts:
--   - id (PK, INT, AUTO_INCREMENT)
--   - name (VARCHAR(255), DEFAULT 'Demand Forecast')
--   - description (TEXT, NULLABLE)
--   - forecastData (JSON, NOT NULL) - stores years, categories, standardEfficiency
--   - userId (INT, NULLABLE, FK to Users)
--   - isActive (TINYINT(1), DEFAULT 1)
--   - createdAt (DATETIME, AUTO)
--   - updatedAt (DATETIME, AUTO UPDATE)
--
-- MonthlyForecasts:
--   - id (PK, INT, AUTO_INCREMENT)
--   - name (VARCHAR(255), DEFAULT 'Monthly Forecast')
--   - description (TEXT, NULLABLE)
--   - forecastData (JSON, NOT NULL) - stores years and packagesByYear
--   - userId (INT, NULLABLE, FK to Users)
--   - isActive (TINYINT(1), DEFAULT 1)
--   - createdAt (DATETIME, AUTO)
--   - updatedAt (DATETIME, AUTO UPDATE)
-- =====================================================

