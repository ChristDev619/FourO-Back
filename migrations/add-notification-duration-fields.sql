/**
 * Migration: Add Duration Fields to Notification Events
 * 
 * Purpose: Enable duration-based state change notifications
 * Feature: Event-driven notification system with delayed triggers
 * 
 * Created: 2025-10-16
 * Author: Senior Development Team
 * 
 * SOLID Principles:
 * - Single Responsibility: Adds ONLY duration-related fields
 * - Open/Closed: Extends functionality without modifying existing structure
 * 
 * Usage:
 * - Up Migration: mysql -u [user] -p [database] < add-notification-duration-fields.sql
 * - Down Migration: See rollback section at bottom
 */

-- =============================================================================
-- UP MIGRATION: Add Duration Fields
-- =============================================================================

USE lms;

-- Add stateDuration column (nullable - duration is optional)
ALTER TABLE notificationevents
ADD COLUMN stateDuration INT NULL
COMMENT 'Duration value (number) - how long state must persist before triggering notification';

-- Add stateDurationUnit column (nullable with default)
ALTER TABLE notificationevents
ADD COLUMN stateDurationUnit ENUM('seconds', 'minutes', 'hours') NULL DEFAULT 'minutes'
COMMENT 'Duration unit - time unit for stateDuration field';

-- Add index for efficient querying of duration-based events
CREATE INDEX idx_state_duration 
ON notificationevents(conditionType, stateDuration, isActive)
COMMENT 'Optimizes queries for active state-change events with duration requirements';

-- Update table comment
ALTER TABLE notificationevents 
COMMENT 'Notification event definitions - supports immediate and duration-based triggers';

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Verify columns were added
SELECT 
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'lms'
  AND TABLE_NAME = 'notificationevents'
  AND COLUMN_NAME IN ('stateDuration', 'stateDurationUnit');

-- Verify index was created
SHOW INDEX FROM notificationevents WHERE Key_name = 'idx_state_duration';

-- Show current table structure
DESCRIBE notificationevents;

-- =============================================================================
-- DATA MIGRATION (if needed)
-- =============================================================================

-- All existing events will have NULL duration (immediate trigger behavior)
-- This maintains backward compatibility - no data migration needed

SELECT 
    id,
    eventName,
    conditionType,
    targetState,
    stateDuration,
    stateDurationUnit,
    isActive
FROM notificationevents
WHERE conditionType = 'state_change'
LIMIT 10;

-- =============================================================================
-- ROLLBACK SCRIPT
-- =============================================================================

/*
-- To rollback this migration, run the following commands:

USE lms;

-- Drop index
DROP INDEX idx_state_duration ON notificationevents;

-- Remove columns
ALTER TABLE notificationevents DROP COLUMN stateDuration;
ALTER TABLE notificationevents DROP COLUMN stateDurationUnit;

-- Verify rollback
DESCRIBE notificationevents;

SELECT 
    COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'lms'
  AND TABLE_NAME = 'notificationevents'
  AND COLUMN_NAME IN ('stateDuration', 'stateDurationUnit');
-- Should return 0 rows after rollback

*/

