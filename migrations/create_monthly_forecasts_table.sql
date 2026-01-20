-- Migration: Create MonthlyForecasts table
-- Description: Stores monthly forecast data for planning
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS `MonthlyForecasts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Monthly Forecast',
  `description` TEXT NULL,
  `forecastData` JSON NOT NULL,
  `userId` INT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_userId` (`userId`),
  INDEX `idx_isActive` (`isActive`),
  INDEX `idx_createdAt` (`createdAt`),
  CONSTRAINT `fk_monthly_forecasts_user` 
    FOREIGN KEY (`userId`) 
    REFERENCES `Users` (`id`) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add comments
ALTER TABLE `MonthlyForecasts` 
  MODIFY COLUMN `name` VARCHAR(255) NOT NULL DEFAULT 'Monthly Forecast' COMMENT 'Name of the monthly forecast',
  MODIFY COLUMN `description` TEXT NULL COMMENT 'Description of the forecast',
  MODIFY COLUMN `forecastData` JSON NOT NULL COMMENT 'JSON structure containing years and packagesByYear with monthly volumes',
  MODIFY COLUMN `userId` INT NULL COMMENT 'Foreign key to Users table (optional)',
  MODIFY COLUMN `isActive` BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Whether this forecast is currently active';

