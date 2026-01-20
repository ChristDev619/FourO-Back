# Design Speed Calculation Explanation

## How Design Speed is Calculated in Reports

### Overview
Design speed represents the theoretical maximum production rate (in bottles per minute) for a specific combination of Line, Recipe, and SKU. It's used in KPI calculations like VOT (Value Operating Time).

### Calculation Flow

The design speed is fetched using the `fetchDesignSpeed(lineId, jobId)` function located in `controllers/Kpis.controller.js` (lines 479-529).

#### Step-by-Step Process:

1. **Get the Job**
   - Retrieves the job record using `jobId`
   - Extracts `job.actualStartTime` to determine when the batch started

2. **Find Recipe Tag**
   - Looks for a tag with `ref = TagRefs.RECIPE` and `taggableId = lineId`
   - This tag stores the recipe name/number for the production line

3. **Get Recipe Tag Value at Job Start**
   - Queries `TagValues` table to find the recipe value that was active at or before `job.actualStartTime`
   - Orders by `createdAt DESC` to get the most recent value before job start
   - Extracts the recipe name from `tagValue.value`

4. **Find LineRecipie Record**
   - Searches `LineRecipies` table for a record matching:
     - `lineId` = the production line
     - `Recipe -> SKU.name` = the recipe name from step 3
   - This junction table connects Lines, Recipes, and Design Speeds

5. **Retrieve Design Speed Value**
   - From the `LineRecipie` record, gets the associated `DesignSpeed` record
   - Returns `DesignSpeed.value` (in bottles per minute)
   - If no match is found, returns 0

### Data Model Relationships

```
Job
  ├── lineId → Line
  └── skuId → SKU

LineRecipie (Junction Table)
  ├── lineId → Line
  ├── recipieId → Recipe
  └── designSpeedId → DesignSpeed

Recipe
  └── skuId → SKU (Recipe name must match SKU name)

DesignSpeed
  ├── value (FLOAT) - bottles per minute
  └── machineId → Machine (bottleneck machine)
```

### Key Connection Points

1. **Line ↔ Recipe ↔ SKU**: Connected through `LineRecipies` junction table
2. **Design Speed**: Stored in `LineRecipies.designSpeedId` which links to `DesignSpeeds.value`
3. **Recipe Name Matching**: The recipe tag value must match a SKU name to find the correct `LineRecipie` record
4. **Time-Based Lookup**: Uses the recipe tag value at job start time, not current time

### Why This Approach?

- **Handles Recipe Changes**: Recipe can change during production, so we use the value at job start time
- **Line-Specific**: Each line can have different design speeds for the same recipe
- **SKU Validation**: Ensures the recipe name matches an actual SKU in the system
- **Prevents Duplicates**: Handles cases where multiple lines might have recipes with the same number but different SKUs

### Example Calculation

For a batch with:
- **Line**: KL1 (lineId: 1)
- **Job Start Time**: 2025-01-15 08:00:00
- **Recipe Tag Value**: "12345" (from TagValues at job start)
- **SKU**: Found SKU with name "12345"
- **LineRecipie**: Found record for lineId=1 and recipe matching SKU "12345"
- **Design Speed**: Retrieved from `LineRecipie.designSpeed.value` = 150.5 bottles/min

### Where Design Speed is Used

1. **VOT Calculation** (`calculateVOT` function):
   - Formula: `VOT = productCount / (designSpeed / 60)`
   - Converts design speed from bottles/min to bottles/hour for calculation

2. **Performance Metrics**: Used in various OEE (Overall Equipment Effectiveness) calculations

### Current Implementation in Reports

Currently, design speed is **NOT displayed** in the production run batches table. It's only used internally for KPI calculations.

To add design speed to the batches display, you would need to:
1. Export `fetchDesignSpeed` from `Kpis.controller.js`
2. Call it for each job in the production run batches mapping
3. Add a column to the frontend table to display the value

### SQL Queries to Verify Design Speed

**1. Check Recipe Tag Value:**
```sql
SELECT tv.value, tv.createdAt 
FROM TagValues tv
JOIN Tags t ON tv.tagId = t.id
WHERE t.taggableId = {lineId} 
  AND t.ref = 'RECIPE'
  AND tv.createdAt <= '{job.actualStartTime}'
ORDER BY tv.createdAt DESC
LIMIT 1;
```

**2. Check LineRecipie Record:**
```sql
SELECT lr.*, r.name as recipe_name, s.name as sku_name, ds.value as design_speed
FROM LineRecipies lr
JOIN Recipies r ON lr.recipieId = r.id
JOIN Skus s ON r.skuId = s.id
JOIN DesignSpeeds ds ON lr.designSpeedId = ds.id
WHERE lr.lineId = {lineId} 
  AND s.name = '{recipeName}';
```

**3. Check Design Speed Value:**
```sql
SELECT ds.value, ds.machineId
FROM DesignSpeeds ds
JOIN LineRecipies lr ON ds.id = lr.designSpeedId
WHERE lr.lineId = {lineId} 
  AND lr.recipieId = {recipeId};
```















