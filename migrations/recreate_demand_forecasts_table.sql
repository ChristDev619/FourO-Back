-- SQL Script to Drop and Recreate DemandForecasts Table
-- This will delete existing data, use with caution!

-- Drop the existing table (if it exists)
DROP TABLE IF EXISTS `DemandForecasts`;

-- Create DemandForecasts table (updated without display widths)
CREATE TABLE `DemandForecasts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Demand Forecast',
  `description` TEXT NULL,
  `forecastData` JSON NOT NULL,
  `userId` INT NULL,
  `isActive` TINYINT NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_demand_forecasts_userId` (`userId`),
  INDEX `idx_demand_forecasts_isActive` (`isActive`),
  CONSTRAINT `fk_demand_forecasts_userId` 
    FOREIGN KEY (`userId`) 
    REFERENCES `Users` (`id`) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verify table creation
SELECT 
  TABLE_NAME, 
  TABLE_ROWS, 
  CREATE_TIME 
FROM 
  information_schema.TABLES 
WHERE 
  TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'DemandForecasts';

-- Show table structure
DESCRIBE DemandForecasts;

