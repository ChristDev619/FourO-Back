-- =====================================================
-- Man Hour Feature - Manual SQL Queries
-- =====================================================
-- Run these queries in your MySQL database to add the 
-- required fields for the Man Hour feature.
-- =====================================================

-- =====================================================
-- 1. Add costPerManHour to TariffTypes table
-- =====================================================
ALTER TABLE `TariffTypes` 
ADD COLUMN `costPerManHour` DECIMAL(10, 2) DEFAULT 0 
COMMENT 'Cost of one man hour in currency units';

-- =====================================================
-- 2. Add manHours to Reports table
-- =====================================================
ALTER TABLE `Reports` 
ADD COLUMN `manHours` DECIMAL(10, 2) DEFAULT 0 
COMMENT 'Man hours (user input for report calculations)';

-- =====================================================
-- Verification Queries (Optional - to check if columns were added)
-- =====================================================

-- Check TariffTypes table structure
-- DESCRIBE `TariffTypes`;

-- Check Reports table structure
-- DESCRIBE `Reports`;

-- =====================================================
-- Rollback Queries (if you need to remove the columns)
-- =====================================================

-- Remove costPerManHour from TariffTypes
-- ALTER TABLE `TariffTypes` DROP COLUMN `costPerManHour`;

-- Remove manHours from Reports
-- ALTER TABLE `Reports` DROP COLUMN `manHours`;

