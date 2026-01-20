-- ============================================
-- Manual Size Update Helper
-- ============================================
-- Use this file to manually update SKU sizes if the automated migration doesn't work perfectly
-- or if you want to add sizes to new SKUs

-- ============================================
-- STEP 1: Review Current Data
-- ============================================
-- See all SKUs with their associated recipe names (to help identify sizes)
SELECT 
  s.id AS sku_id,
  s.name AS sku_name,
  s.sizeValue,
  s.sizeUnit,
  GROUP_CONCAT(DISTINCT r.name SEPARATOR ' | ') AS recipe_names
FROM Skus s
LEFT JOIN Recipes r ON r.skuId = s.id
GROUP BY s.id
ORDER BY s.id;

-- ============================================
-- STEP 2: Manual Update Examples
-- ============================================

-- Example 1: Update a specific SKU by ID
-- UPDATE Skus SET sizeValue = 0.5, sizeUnit = 'L' WHERE id = 1;

-- Example 2: Update by SKU name pattern
-- UPDATE Skus SET sizeValue = 6, sizeUnit = 'L' WHERE name LIKE '%6L%';

-- Example 3: Update multiple SKUs at once
/*
UPDATE Skus 
SET 
  sizeValue = CASE id
    WHEN 1 THEN 0.5
    WHEN 2 THEN 6
    WHEN 3 THEN 1.5
    ELSE sizeValue
  END,
  sizeUnit = CASE id
    WHEN 1 THEN 'L'
    WHEN 2 THEN 'L'
    WHEN 3 THEN 'L'
    ELSE sizeUnit
  END
WHERE id IN (1, 2, 3);
*/

-- ============================================
-- STEP 3: Common Size Updates
-- ============================================

-- For Water products (adjust as needed)
-- UPDATE Skus SET sizeValue = 0.5, sizeUnit = 'L' WHERE name LIKE '%0.5%' OR name LIKE '%500mL%';
-- UPDATE Skus SET sizeValue = 1, sizeUnit = 'L' WHERE name LIKE '%1L%' OR name LIKE '%1.0L%';
-- UPDATE Skus SET sizeValue = 1.5, sizeUnit = 'L' WHERE name LIKE '%1.5L%';
-- UPDATE Skus SET sizeValue = 6, sizeUnit = 'L' WHERE name LIKE '%6L%';

-- ============================================
-- STEP 4: Verify Updates
-- ============================================
SELECT 
  id,
  name,
  sizeValue,
  sizeUnit,
  CONCAT(
    CASE 
      WHEN sizeValue % 1 = 0 THEN CAST(sizeValue AS UNSIGNED)
      ELSE sizeValue
    END,
    sizeUnit
  ) AS formatted_size,
  CASE 
    WHEN sizeValue IS NULL THEN '⚠️ Missing Size'
    ELSE '✅ Has Size'
  END AS status
FROM Skus
ORDER BY 
  CASE WHEN sizeValue IS NULL THEN 0 ELSE 1 END,
  sizeValue ASC;

-- ============================================
-- STEP 5: Summary Report
-- ============================================
SELECT 
  '📊 Summary Report' AS report,
  CONCAT('Total SKUs: ', COUNT(*)) AS total,
  CONCAT('With Size: ', SUM(CASE WHEN sizeValue IS NOT NULL THEN 1 ELSE 0 END)) AS with_size,
  CONCAT('Missing Size: ', SUM(CASE WHEN sizeValue IS NULL THEN 1 ELSE 0 END)) AS missing_size,
  CONCAT('Completion: ', 
    ROUND(SUM(CASE WHEN sizeValue IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*) * 100, 1), 
    '%'
  ) AS completion_rate
FROM Skus;

