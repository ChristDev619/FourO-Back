# Debug Guide: Price per Liter = 0.00 Issue

## Problem
- **Price per Liter (at job start)**: 0.00 /L
- **Cost of KWH per Diesel**: 0.00 (because Price per Liter = 0)

## Root Cause Analysis

The `getPricePerLiterAtJobStart` function can return 0 for several reasons. Let's trace through the logic:

### Step-by-Step Logic Flow:

1. **Get Line's Location ID**
   - ✅ Line must have `locationId`
   - ❌ If missing → returns 0

2. **Find Meters at Location**
   - ✅ Find all meters where `locationId = line.locationId`
   - ❌ If no meters found → returns 0

3. **Find Generators Connected to Meters**
   - ✅ Find generators via `GeneratorMeter` table where `meterId IN (meterIds)`
   - ⚠️ If no generators found via meters → **Fallback**: Find generators directly by `locationId`
   - ❌ If still no generators found → returns 0

4. **Get Generator's TariffType ID**
   - ✅ Generator must have `tariffTypeId`
   - ❌ If missing → returns 0

5. **Find Active TariffUsage**
   - ✅ Must find TariffUsage where:
     - `startDate <= jobStartTime`
     - `endDate >= jobStartTime`
     - `tariff.typeId = generator.tariffTypeId`
   - ❌ If not found → returns 0

6. **Get Price from Tariff**
   - ✅ Tariff must have `pricePerLiter > 0`
   - ❌ If 0 or null → returns 0

---

## Debugging Steps

### Step 1: Check Job Start Time
From your screenshot: **Job Start Time = 12/12/2025 06:05**

### Step 2: Check Tariff Usage Coverage
From your screenshot:
- **Start Date**: 2024-12-11
- **End Date**: 2026-12-11
- **Tariff**: T1

✅ **This should cover the job start time** (12/12/2025 is between 2024-12-11 and 2026-12-11)

### Step 3: Check Backend Console Logs

Look for these log messages in your backend console:

```
🔍 [EMS] getPricePerLiterAtJobStart - START
  📊 Line ID: [lineId]
  ⏰ Job Start Time: [jobStartTime]
  📍 Line Location ID: [locationId]
  📋 All meters found: [count]
  ⚡ Generator-Meter connections found: [count]
  ⚡ Generators found by location: [count]
  ✅ Using Generator ID: [id] with TariffType ID: [tariffTypeId]
  💰 TariffUsage lookup:
    - Job Start Time: [time]
    - Looking for TariffUsage where startDate <= jobStartTime AND endDate >= jobStartTime
    - With Tariff where typeId = [tariffTypeId]
  📋 Recent TariffUsages (last 10): [list]
```

### Step 4: Common Issues & Solutions

#### Issue 1: No Meters Found
**Symptoms:**
```
⚠ [EMS] No meters found for location: [locationId]
```

**Solution:**
- Check if the line has a `locationId`
- Check if meters exist with `locationId = line.locationId`
- Run SQL:
  ```sql
  SELECT * FROM meters WHERE locationId = [line.locationId];
  ```

#### Issue 2: No Generators Found
**Symptoms:**
```
⚠ [EMS] No generators found for location: [locationId]
```

**Solution:**
- Check if generators exist for the location
- Check `GeneratorMeter` table for connections
- Run SQL:
  ```sql
  -- Check generators by location
  SELECT * FROM generators WHERE locationId = [line.locationId];
  
  -- Check generator-meter connections
  SELECT gm.*, g.tariffTypeId 
  FROM generatormeters gm
  JOIN generators g ON gm.generatorId = g.id
  JOIN meters m ON gm.meterId = m.id
  WHERE m.locationId = [line.locationId];
  ```

#### Issue 3: Generator Has No TariffTypeId
**Symptoms:**
```
⚠ [EMS] No generator with tariffTypeId found
```

**Solution:**
- Check if generator has `tariffTypeId`
- Run SQL:
  ```sql
  SELECT id, name, locationId, tariffTypeId 
  FROM generators 
  WHERE locationId = [line.locationId];
  ```

#### Issue 4: No Active TariffUsage Found
**Symptoms:**
```
⚠ [EMS] No active TariffUsage found at job start time
```

**This is likely your issue!** Check:

1. **TariffUsage exists but wrong TariffTypeId:**
   ```sql
   -- Check what tariffTypeId the generator has
   SELECT g.id, g.name, g.tariffTypeId 
   FROM generators g
   WHERE g.locationId = [line.locationId];
   
   -- Check what tariffTypeId the TariffUsage references
   SELECT tu.*, t.typeId, t.pricePerLiter
   FROM tariffusages tu
   JOIN tariffs t ON tu.tariffId = t.id
   WHERE tu.startDate <= '2025-12-12 06:05:00'
     AND tu.endDate >= '2025-12-12 06:05:00';
   ```

2. **TariffUsage date range doesn't cover job start:**
   - Job start: 2025-12-12 06:05:00
   - TariffUsage: 2024-12-11 to 2026-12-11 ✅ (should work)
   - But check if dates are stored correctly (time component matters!)

3. **Tariff linked to TariffUsage doesn't have matching typeId:**
   ```sql
   -- Check the full chain
   SELECT 
     tu.id as tariffUsageId,
     tu.startDate,
     tu.endDate,
     t.id as tariffId,
     t.typeId as tariffTypeId,
     t.pricePerLiter,
     g.id as generatorId,
     g.tariffTypeId as generatorTariffTypeId
   FROM tariffusages tu
   JOIN tariffs t ON tu.tariffId = t.id
   CROSS JOIN generators g
   WHERE g.locationId = [line.locationId]
     AND tu.startDate <= '2025-12-12 06:05:00'
     AND tu.endDate >= '2025-12-12 06:05:00';
   ```

#### Issue 5: Tariff PricePerLiter is 0 or NULL
**Symptoms:**
```
✅ TariffUsage found!
  - Price Per Liter: 0
```

**Solution:**
- Check if Tariff has `pricePerLiter > 0`
- Run SQL:
  ```sql
  SELECT t.id, t.name, t.typeId, t.pricePerLiter
  FROM tariffs t
  JOIN tariffusages tu ON t.id = tu.tariffId
  WHERE tu.id = [tariffUsageId];
  ```

---

## Quick Debug SQL Queries

### Query 1: Check Line Location
```sql
SELECT id, name, locationId 
FROM lines 
WHERE id = [lineId];
```

### Query 2: Check Meters at Location
```sql
SELECT id, name, type, locationId, machineId 
FROM meters 
WHERE locationId = [line.locationId];
```

### Query 3: Check Generators
```sql
-- By location
SELECT id, name, locationId, tariffTypeId 
FROM generators 
WHERE locationId = [line.locationId];

-- By meter connections
SELECT g.id, g.name, g.tariffTypeId, m.id as meterId, m.name as meterName
FROM generators g
JOIN generatormeters gm ON g.id = gm.generatorId
JOIN meters m ON gm.meterId = m.id
WHERE m.locationId = [line.locationId];
```

### Query 4: Check TariffUsage for Job Start Time
```sql
SELECT 
  tu.id,
  tu.startDate,
  tu.endDate,
  tu.tariffId,
  t.id as tariffId,
  t.name as tariffName,
  t.typeId,
  t.pricePerLiter,
  '2025-12-12 06:05:00' as jobStartTime,
  CASE 
    WHEN tu.startDate <= '2025-12-12 06:05:00' AND tu.endDate >= '2025-12-12 06:05:00' 
    THEN 'YES' 
    ELSE 'NO' 
  END as coversJobStart
FROM tariffusages tu
JOIN tariffs t ON tu.tariffId = t.id
ORDER BY tu.startDate DESC;
```

### Query 5: Full Chain Check
```sql
-- Replace [lineId] and [locationId] with actual values
SELECT 
  l.id as lineId,
  l.name as lineName,
  l.locationId,
  m.id as meterId,
  m.name as meterName,
  m.type as meterType,
  g.id as generatorId,
  g.name as generatorName,
  g.tariffTypeId as generatorTariffTypeId,
  tu.id as tariffUsageId,
  tu.startDate,
  tu.endDate,
  t.id as tariffId,
  t.name as tariffName,
  t.typeId as tariffTypeId,
  t.pricePerLiter,
  CASE 
    WHEN tu.startDate <= '2025-12-12 06:05:00' AND tu.endDate >= '2025-12-12 06:05:00' 
    THEN 'YES' 
    ELSE 'NO' 
  END as coversJobStart,
  CASE 
    WHEN g.tariffTypeId = t.typeId 
    THEN 'MATCH' 
    ELSE 'MISMATCH' 
  END as typeIdMatch
FROM lines l
LEFT JOIN meters m ON l.locationId = m.locationId AND m.type = 'receiver'
LEFT JOIN generatormeters gm ON m.id = gm.meterId
LEFT JOIN generators g ON gm.generatorId = g.id
LEFT JOIN tariffusages tu ON tu.startDate <= '2025-12-12 06:05:00' AND tu.endDate >= '2025-12-12 06:05:00'
LEFT JOIN tariffs t ON tu.tariffId = t.id AND t.typeId = g.tariffTypeId
WHERE l.id = [lineId];
```

---

## Most Likely Issues Based on Your Screenshots

### Issue A: Generator TariffTypeId Mismatch
- Your TariffUsage references Tariff "T1"
- Tariff "T1" has `typeId` (e.g., 1 for "Diesel")
- But the generator at the line's location might have a different `tariffTypeId`
- **Check**: Does the generator's `tariffTypeId` match the Tariff's `typeId`?

### Issue B: No Generator Found
- The line's location might not have any generators connected
- **Check**: Are there generators at the line's location?

### Issue C: Date/Time Format Issue
- Job start: `2025-12-12 06:05:00`
- TariffUsage: `2024-12-11` to `2026-12-11` (might be stored as `2024-12-11 00:00:00` to `2026-12-11 00:00:00`)
- The comparison should work, but check the exact datetime values

---

## Action Plan

1. **Check Backend Console Logs** - Look for the detailed logs from `getPricePerLiterAtJobStart`
2. **Run Query 5 (Full Chain Check)** - This will show you exactly where the chain breaks
3. **Check Generator TariffTypeId** - Make sure it matches the Tariff's typeId
4. **Verify TariffUsage Dates** - Ensure they cover the job start time with proper datetime format

---

## Expected Log Output (When Working)

```
🔍 [EMS] getPricePerLiterAtJobStart - START
  📊 Line ID: 22
  ⏰ Job Start Time: 2025-12-12T06:05:00.000Z
  📍 Line Location ID: 40
  📋 All meters found: 2
    - Meter ID: 88, Name: Meter1, Location ID: 40, Type: receiver
    - Meter ID: 89, Name: Meter2, Location ID: 40, Type: receiver
  ⚡ Generator-Meter connections found: 1
    - Generator ID: 28, Meter ID: 88, TariffType ID: 1
  ✅ Using Generator ID: 28 with TariffType ID: 1
  💰 TariffUsage lookup:
    - Job Start Time: 2025-12-12T06:05:00.000Z
    - Looking for TariffUsage where startDate <= jobStartTime AND endDate >= jobStartTime
    - With Tariff where typeId = 1
  📋 Recent TariffUsages (last 10): 1
    - TariffUsage ID: 1, Start: 2024-12-11, End: 2026-12-11, Tariff TypeId: 1, Price/L: 25
  ✅ TariffUsage found!
    - TariffUsage ID: 1
    - Start Date: 2024-12-11
    - End Date: 2026-12-11
    - Tariff ID: 1
    - Price Per Liter: 25
🔍 [EMS] getPricePerLiterAtJobStart - END
```

If you see different output, that's where the issue is!

