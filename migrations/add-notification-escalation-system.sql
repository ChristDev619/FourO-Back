-- ============================================================
-- NOTIFICATION ESCALATION & ACKNOWLEDGMENT SYSTEM MIGRATION
-- ============================================================
-- Purpose: Add fields for email acknowledgment and multi-level escalation workflow
-- Date: 2025-10-17
-- 
-- Features:
-- 1. Email acknowledgment with secure tokens (3-month expiry)
-- 2. Multi-level escalation workflow (sequential chain)
-- 3. Escalation tracking and job management
-- 4. Original user acknowledgment requirement
-- ============================================================

-- ============================================================
-- TABLE: NotificationEvents (Configuration)
-- ============================================================
ALTER TABLE notificationevents 
-- Escalation Enable/Disable
ADD COLUMN enableEscalation BOOLEAN DEFAULT FALSE COMMENT 'Enable escalation workflow for this event',

-- Escalation Timing
ADD COLUMN escalationDelay INT NULL COMMENT 'Time to wait before escalating (e.g., 2 hours)',
ADD COLUMN escalationDelayUnit ENUM('minutes', 'hours', 'days') DEFAULT 'hours' COMMENT 'Unit for escalation delay',

-- Escalation Chain Configuration
ADD COLUMN escalationUserIds JSON NULL COMMENT 'Ordered array of user IDs for sequential escalation: [manager, director, ceo]',
ADD COLUMN maxEscalationLevel INT DEFAULT 1 COMMENT 'Maximum escalation levels (1=single, 2+=multi-level)',

-- Index for escalation queries
ADD INDEX idx_escalation_enabled (enableEscalation, isActive);


-- ============================================================
-- TABLE: Notifications (History & Tracking)
-- ============================================================
ALTER TABLE notifications
-- Email Acknowledgment System
ADD COLUMN emailToken VARCHAR(64) UNIQUE NULL COMMENT 'Secure token for email acknowledgment link (64-char hex)',
ADD COLUMN acknowledgedAt DATETIME NULL COMMENT 'Timestamp when user clicked acknowledge in email',
ADD COLUMN tokenExpiresAt DATETIME NULL COMMENT 'Token expiration (90 days from creation)',

-- Escalation Tracking
ADD COLUMN escalationLevel INT DEFAULT 0 COMMENT 'Current escalation level: 0=original, 1=first escalation, 2=second, etc.',
ADD COLUMN escalationJobId VARCHAR(255) NULL COMMENT 'Bull queue job ID for scheduled escalation check',
ADD COLUMN parentNotificationId INT NULL COMMENT 'Reference to original notification ID (for escalated copies)',

-- Foreign Key for Parent Notification (self-reference)
ADD CONSTRAINT fk_parent_notification 
    FOREIGN KEY (parentNotificationId) 
    REFERENCES notifications(id) 
    ON DELETE SET NULL,

-- Indexes for Performance
ADD INDEX idx_email_token (emailToken),
ADD INDEX idx_escalation_check (acknowledgedAt, escalationJobId),
ADD INDEX idx_escalation_level (escalationLevel, parentNotificationId),
ADD INDEX idx_token_expiry (tokenExpiresAt);


-- ============================================================
-- VALIDATION & COMMENTS
-- ============================================================

-- Add helpful comments
ALTER TABLE notificationevents 
MODIFY COLUMN escalationUserIds JSON NULL 
COMMENT 'Sequential escalation chain: [userId1, userId2, userId3]. Triggered in order if original user does not acknowledge.';

ALTER TABLE notifications 
MODIFY COLUMN parentNotificationId INT NULL 
COMMENT 'For escalated notifications: links to the original notification. NULL for original notifications.';

ALTER TABLE notifications 
MODIFY COLUMN escalationJobId VARCHAR(255) NULL 
COMMENT 'Bull queue job ID for next escalation check. Cancelled when acknowledged.';


-- ============================================================
-- ROLLBACK (if needed)
-- ============================================================
-- To rollback this migration, run:
-- 
-- ALTER TABLE notificationevents 
-- DROP COLUMN enableEscalation,
-- DROP COLUMN escalationDelay,
-- DROP COLUMN escalationDelayUnit,
-- DROP COLUMN escalationUserIds,
-- DROP COLUMN maxEscalationLevel,
-- DROP INDEX idx_escalation_enabled;
--
-- ALTER TABLE notifications
-- DROP FOREIGN KEY fk_parent_notification,
-- DROP COLUMN emailToken,
-- DROP COLUMN acknowledgedAt,
-- DROP COLUMN tokenExpiresAt,
-- DROP COLUMN escalationLevel,
-- DROP COLUMN escalationJobId,
-- DROP COLUMN parentNotificationId,
-- DROP INDEX idx_email_token,
-- DROP INDEX idx_escalation_check,
-- DROP INDEX idx_escalation_level,
-- DROP INDEX idx_token_expiry;

