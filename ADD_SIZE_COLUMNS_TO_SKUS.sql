-- ============================================
-- Add Size Columns to Skus Table
-- ============================================
-- This migration adds separate columns for size value and unit
-- Following proper data normalization principles

ALTER TABLE Skus 
  ADD COLUMN sizeValue DECIMAL(10,3) NULL COMMENT 'Numeric size value (e.g., 0.5, 6, 500)',
  ADD COLUMN sizeUnit VARCHAR(10) NULL DEFAULT 'L' COMMENT 'Size unit: L, mL, Gal, oz';

-- Add indexes for better query performance
CREATE INDEX idx_skus_size_value ON Skus(sizeValue);
CREATE INDEX idx_skus_size_unit ON Skus(sizeUnit);

-- Verify the changes
SELECT 'Columns added successfully!' AS status;
DESCRIBE Skus;

