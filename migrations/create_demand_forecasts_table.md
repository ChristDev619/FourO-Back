# Demand Forecasts Table Creation

## Manual Database Setup

This guide shows you how to manually create the `DemandForecasts` table in your MySQL database.

## Option 1: Using MySQL Command Line

```bash
# Connect to your MySQL database
mysql -u your_username -p your_database_name

# Then run the SQL script
source migrations/create_demand_forecasts_table.sql

# Or paste the SQL directly:
```

## Option 2: Using MySQL Workbench / phpMyAdmin / Azure Data Studio

1. Open your database management tool
2. Connect to your database
3. Open the SQL script: `FourO-Back/migrations/create_demand_forecasts_table.sql`
4. Execute the script

## Option 3: Direct SQL Execution

```sql
-- Create DemandForecasts table
CREATE TABLE IF NOT EXISTS `DemandForecasts` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Demand Forecast',
  `description` TEXT NULL,
  `forecastData` JSON NOT NULL,
  `userId` INT(11) NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
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
```

## Verification

After running the script, verify the table was created:

```sql
-- Check if table exists
SHOW TABLES LIKE 'DemandForecasts';

-- View table structure
DESCRIBE DemandForecasts;

-- Or
SHOW CREATE TABLE DemandForecasts;
```

## Table Structure

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT(11) | Primary key, auto-increment |
| `name` | VARCHAR(255) | Forecast name (default: "Demand Forecast") |
| `description` | TEXT | Optional description |
| `forecastData` | JSON | Stores categories, packages, years, growth data |
| `userId` | INT(11) | Optional foreign key to Users table |
| `isActive` | TINYINT(1) | Boolean flag (default: true) |
| `createdAt` | DATETIME | Auto-managed timestamp |
| `updatedAt` | DATETIME | Auto-updated timestamp |

## Indexes

- **Primary Key**: `id`
- **Index on userId**: For faster user-specific queries
- **Index on isActive**: For faster active forecast queries
- **Foreign Key**: `userId` references `Users.id`

## Notes

- The `forecastData` JSON column stores the entire forecast structure:
  ```json
  {
    "years": [
      {"id": "year-1", "label": "Year -1", "year": 2025, "isCurrent": true},
      ...
    ],
    "categories": [
      {
        "id": "water",
        "name": "Water",
        "expanded": true,
        "growth": {"year0": 8.0, "year1": 5.0, ...},
        "packages": [...]
      },
      ...
    ]
  }
  ```

- The table uses `utf8mb4` charset to support emojis and special characters
- Foreign key constraint ensures referential integrity with Users table
- `ON DELETE SET NULL` means if a user is deleted, their forecasts remain but `userId` becomes NULL

## Troubleshooting

### Error: "Table already exists"
If the table already exists and you want to recreate it:
```sql
DROP TABLE IF EXISTS DemandForecasts;
-- Then run the CREATE TABLE script again
```

### Error: "Foreign key constraint fails"
Make sure the `Users` table exists before creating this table.

### Error: "Unknown storage engine 'InnoDB'"
If using an older MySQL version, you may need to change `ENGINE=InnoDB` to `ENGINE=MyISAM`, though InnoDB is recommended.

## Next Steps

After creating the table:

1. Restart your backend server
2. The API endpoints will be available at:
   - `POST /api/demand-forecasts` - Create forecast
   - `GET /api/demand-forecasts/active` - Get active forecast
   - `GET /api/demand-forecasts` - List all forecasts
   - `PATCH /api/demand-forecasts/:id` - Update forecast
   - `DELETE /api/demand-forecasts/:id` - Delete forecast

3. Test the endpoint:
```bash
curl -X GET http://localhost:8011/api/demand-forecasts/active
```

