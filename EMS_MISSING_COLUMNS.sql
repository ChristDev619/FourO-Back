-- =====================================================
-- EMS (Energy Management System) - Missing Columns
-- Add these columns to your online database
-- =====================================================

-- 1. Reports Table - Volume of Diesel (User Input)
-- Migration: 20250115000000-add-volumeOfDiesel-to-reports.js
ALTER TABLE `Reports` 
ADD COLUMN `volumeOfDiesel` DECIMAL(10, 2) NULL DEFAULT 0 
COMMENT 'Volume of diesel in liters (user input for EMS calculations)';

-- 2. Reports Table - Man Hours (User Input)
-- Migration: 20250116000001-add-manHours-to-reports.js
ALTER TABLE `Reports` 
ADD COLUMN `manHours` DECIMAL(10, 2) NULL DEFAULT 0 
COMMENT 'Man hours (user input for report calculations)';

-- 3. TariffTypes Table - Cost Per Man Hour
-- Migration: 20250116000000-add-costPerManHour-to-tariffTypes.js
ALTER TABLE `TariffTypes` 
ADD COLUMN `costPerManHour` DECIMAL(10, 2) NULL DEFAULT 0 
COMMENT 'Cost of one man hour in currency units';

-- =====================================================
-- Optional: Check if these columns already exist
-- =====================================================
-- If you want to check before adding, run:
-- 
-- SELECT COLUMN_NAME 
-- FROM INFORMATION_SCHEMA.COLUMNS 
-- WHERE TABLE_SCHEMA = 'your_database_name' 
--   AND TABLE_NAME = 'Reports' 
--   AND COLUMN_NAME IN ('volumeOfDiesel', 'manHours');
--
-- SELECT COLUMN_NAME 
-- FROM INFORMATION_SCHEMA.COLUMNS 
-- WHERE TABLE_SCHEMA = 'your_database_name' 
--   AND TABLE_NAME = 'TariffTypes' 
--   AND COLUMN_NAME = 'costPerManHour';
-- =====================================================

