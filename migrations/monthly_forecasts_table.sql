-- =====================================================
-- Monthly Forecasts Table Creation Script
-- =====================================================
-- Execute this script in your MySQL database to create
-- the MonthlyForecasts table for the Planning feature
-- =====================================================

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

