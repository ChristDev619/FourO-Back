-- Create SeasonalityData table for storing monthly seasonality percentages
-- This table stores seasonality data for demand forecasting

CREATE TABLE IF NOT EXISTS `SeasonalityData` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Seasonality Data',
  `description` TEXT NULL,
  `seasonalityData` JSON NOT NULL,
  `userId` INT NULL,
  `isActive` TINYINT NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_seasonality_data_userId` (`userId`),
  INDEX `idx_seasonality_data_isActive` (`isActive`),
  CONSTRAINT `fk_seasonality_data_userId` 
    FOREIGN KEY (`userId`) 
    REFERENCES `Users` (`id`) 
    ON DELETE SET NULL 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure explanation:
-- - id: Primary key
-- - name: Name of the seasonality data set (default: "Seasonality Data")
-- - description: Optional description
-- - seasonalityData: JSON field storing:
--   {
--     "years": [
--       {"id": "year-1", "label": "Year -1", "year": 2025, "isCurrent": true},
--       {"id": "year0", "label": "Year 0", "year": 2026}
--     ],
--     "packagesByYear": {
--       "year-1": [
--         {
--           "id": 123456789,
--           "recipeId": 1,
--           "recipeName": "0.6 L Water",
--           "monthlyValues": {
--             "jan": 5.56,
--             "feb": 5.47,
--             "mar": 5.45,
--             ...
--             "dec": 5.50
--           },
--           "seasonalityFactor": 11.97
--         }
--       ],
--       "year0": [...]
--     }
--   }
-- - userId: Optional foreign key to Users table
-- - isActive: Boolean flag to mark active/inactive records
-- - createdAt: Timestamp when record was created
-- - updatedAt: Timestamp when record was last updated

