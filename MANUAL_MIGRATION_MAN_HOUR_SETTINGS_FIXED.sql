-- =====================================================
-- MANUAL MIGRATION: Man Hour Settings (MySQL Compatible)
-- Run these SQL statements manually in your database
-- =====================================================

-- STEP 1: Create Settings table
-- =====================================================
CREATE TABLE IF NOT EXISTS `Settings` (
  `id` INT NOT NULL DEFAULT 1,
  `costPerManHour` DECIMAL(10, 2) NOT NULL DEFAULT 0 COMMENT 'Global cost per man hour in currency units (applies to all reports)',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `settings_single_row` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 2: Insert initial row with default value
-- =====================================================
INSERT INTO `Settings` (`id`, `costPerManHour`, `createdAt`, `updatedAt`)
VALUES (1, 0, NOW(), NOW())
ON DUPLICATE KEY UPDATE `updatedAt` = NOW();

-- STEP 3: Check if costPerManHour column exists in TariffTypes
-- =====================================================
-- Run this first to check if the column exists:
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'TariffTypes' 
  AND COLUMN_NAME = 'costPerManHour';

-- STEP 4: Remove costPerManHour column from TariffTypes table
-- =====================================================
-- WARNING: This will permanently remove the costPerManHour column
-- Make sure you have a backup before running this!
-- Only run this if the column exists (from Step 3 check)
ALTER TABLE `TariffTypes` DROP COLUMN `costPerManHour`;

-- =====================================================
-- VERIFICATION QUERIES (Run these to verify)
-- =====================================================

-- Check if Settings table exists and has data
-- SELECT * FROM Settings;

-- Check if TariffTypes no longer has costPerManHour column
-- DESCRIBE TariffTypes;

-- =====================================================
-- ROLLBACK (If you need to undo)
-- =====================================================
-- If you need to rollback, run these:

-- 1. Add costPerManHour back to TariffTypes
-- ALTER TABLE `TariffTypes` 
-- ADD COLUMN `costPerManHour` DECIMAL(10, 2) NULL DEFAULT 0 
-- COMMENT 'Cost of one man hour in currency units';

-- 2. Drop Settings table (optional)
-- DROP TABLE IF EXISTS `Settings`;

