# Azure Flexible Server - Planning Tables Setup Guide

## Overview
This guide helps you set up all Planning feature tables in your Azure MySQL Flexible Server database (`flexibleserverdb`).

## Planning Feature Tables Required

The Planning feature consists of **3 main tables**:

1. **SeasonalityData** - Stores monthly seasonality percentages
2. **DemandForecasts** - Stores yearly demand forecasts (you mentioned this already exists)
3. **MonthlyForecasts** - Stores calculated monthly forecasts

## Step-by-Step Setup

### Step 1: Check Current State
First, run the check script to see what tables already exist:

```sql
-- Run: check_planning_tables.sql
```

This will show you:
- Which tables exist
- Their current structure
- Missing columns
- Foreign keys and indexes

### Step 2: Create/Update Tables

#### Option A: If DemandForecasts table is empty or you want to recreate it
Run the main setup script:

```sql
-- Run: azure_planning_tables_setup.sql
```

This creates all 3 tables with the correct structure.

#### Option B: If DemandForecasts already has data
1. First, check the current structure:
   ```sql
   DESCRIBE DemandForecasts;
   ```

2. If columns are missing, run:
   ```sql
   -- Run: alter_demand_forecasts_if_exists.sql
   ```

3. Then create the other 2 tables:
   ```sql
   -- Run only SeasonalityData and MonthlyForecasts sections from azure_planning_tables_setup.sql
   ```

## Required Table Structures

### 1. SeasonalityData Table
```sql
CREATE TABLE `SeasonalityData` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Seasonality Data',
  `description` TEXT NULL,
  `seasonalityData` JSON NOT NULL,  -- Stores years and packagesByYear
  `userId` INT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_seasonality_data_userId` (`userId`),
  INDEX `idx_seasonality_data_isActive` (`isActive`),
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Key Column**: `seasonalityData` (JSON) - Stores:
- `years`: Array of year objects
- `packagesByYear`: Object with year keys, each containing array of packages with monthly percentages

### 2. DemandForecasts Table
```sql
CREATE TABLE `DemandForecasts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Demand Forecast',
  `description` TEXT NULL,
  `forecastData` JSON NOT NULL,  -- Stores years, categories, standardEfficiency
  `userId` INT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_demand_forecasts_userId` (`userId`),
  INDEX `idx_demand_forecasts_isActive` (`isActive`),
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Key Column**: `forecastData` (JSON) - Stores:
- `years`: Array of year objects
- `categories`: Array of category objects with packages
- `standardEfficiency`: Efficiency values

### 3. MonthlyForecasts Table
```sql
CREATE TABLE `MonthlyForecasts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Monthly Forecast',
  `description` TEXT NULL,
  `forecastData` JSON NOT NULL,  -- Stores years and packagesByYear
  `userId` INT NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_monthly_forecasts_userId` (`userId`),
  INDEX `idx_monthly_forecasts_isActive` (`isActive`),
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Key Column**: `forecastData` (JSON) - Stores:
- `years`: Array of year objects
- `packagesByYear`: Object with year keys, each containing array of packages with monthly volumes

## Important Notes

### JSON Column Requirements
All three tables use **JSON columns** to store flexible data structures:
- `SeasonalityData.seasonalityData`
- `DemandForecasts.forecastData`
- `MonthlyForecasts.forecastData`

MySQL 5.7+ supports JSON data type. Azure Flexible Server should support this.

### Foreign Key Dependency
All tables have a foreign key to `Users` table:
- `userId` → `Users.id`
- `ON DELETE SET NULL` - If user is deleted, userId becomes NULL
- `ON UPDATE CASCADE` - If user id changes, it updates here

**Make sure `Users` table exists before creating these tables!**

### Indexes
Each table has indexes on:
- `userId` - For filtering by user
- `isActive` - For filtering active records
- `createdAt` - For sorting by creation date

### isActive Column
- `TINYINT(1)` or `BOOLEAN` - Used to mark active/inactive records
- Default: `1` (active)
- Only one record per table should typically be active at a time

## Verification

After running the setup scripts, verify with:

```sql
-- Check all tables exist
SHOW TABLES LIKE '%Forecast%';
SHOW TABLES LIKE 'Seasonality%';

-- Check table structures
DESCRIBE SeasonalityData;
DESCRIBE DemandForecasts;
DESCRIBE MonthlyForecasts;

-- Check foreign keys
SELECT 
  CONSTRAINT_NAME,
  TABLE_NAME,
  COLUMN_NAME,
  REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('SeasonalityData', 'DemandForecasts', 'MonthlyForecasts');
```

## Migration from Local Database

If you have data in your local `lmsold` database:

1. **Export data from local**:
   ```sql
   -- In local database
   SELECT * FROM SeasonalityData;
   SELECT * FROM DemandForecasts;
   SELECT * FROM MonthlyForecasts;
   ```

2. **Import to Azure**:
   - Use MySQL Workbench, Azure Data Studio, or `mysqldump`
   - Or manually insert JSON data

3. **Verify data integrity**:
   - Check JSON structure is valid
   - Verify foreign keys (userId exists in Users table)
   - Check isActive flags

## Troubleshooting

### Error: "Table already exists"
- Use `CREATE TABLE IF NOT EXISTS` (included in scripts)
- Or drop table first: `DROP TABLE IF EXISTS DemandForecasts;`

### Error: "Foreign key constraint fails"
- Ensure `Users` table exists
- Check that `userId` values reference existing user IDs

### Error: "Invalid JSON"
- Verify JSON structure matches expected format
- Use `JSON_VALID()` function to check JSON validity

### Missing Columns
- Run the alter script: `alter_demand_forecasts_if_exists.sql`
- Or manually add missing columns

## Files Provided

1. **azure_planning_tables_setup.sql** - Main setup script (creates all 3 tables)
2. **check_planning_tables.sql** - Diagnostic script (checks current state)
3. **alter_demand_forecasts_if_exists.sql** - Updates existing DemandForecasts table

## Next Steps

After tables are created:
1. Update your backend connection string to point to Azure database
2. Test API endpoints for each Planning page
3. Verify data can be saved and loaded
4. Check that calculations work correctly

