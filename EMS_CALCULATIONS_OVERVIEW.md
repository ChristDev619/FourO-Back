# Energy Management System (EMS) - Calculation Overview
## For Business Analyst Review

---

## Overview
The EMS section calculates energy consumption metrics and costs for production jobs. All calculations are performed **per job** and then aggregated for date-range reports.

---

## 1. Total KWH Consumption

### Purpose
Measures total energy consumed during the job period.

### Calculation Algorithm
1. **Find Receiver Meters**: Get all meters of type "receiver" at the line's location
2. **Find KWH Tags**: For each receiver meter, find tags with unit = "kwh"
3. **Calculate Consumption per Tag**:
   - Find first tag value at or after job start time
   - Find last tag value at or before job end time
   - Consumption = Last Value - First Value
4. **Sum All Tags**: Add consumption from all receiver meter tags

### Formula
```
Total KWH = Σ (Last Tag Value - First Tag Value) for all receiver meter tags
```

### Data Sources
- **Meters Table**: Filter by `locationId` (from line) and `type = 'receiver'`
- **Tags Table**: Filter by `taggableType = 'meter'`, `taggableId = meter.id`, `unitId = kwh unit`
- **TagValues Table**: Filter by `tagId` and time range between job start and end

### Notes
- Only uses **receiver** meters (not generator meters)
- Meters are connected to **location**, not machines
- If no receiver meters or tags found → returns 0

---

## 2. Total Liters Produced

### Purpose
Calculates total volume of product produced in liters.

### Calculation Algorithm
1. **Get SKU Size**: Extract `sizeValue` and `sizeUnit` from SKU
2. **Convert to Liters per Bottle**:
   - If unit is **L/liter/liters** → use directly
   - If unit is **ml** → divide by 1000
   - If unit is **oz** → multiply by 0.0295735
   - If unit is **gal** → multiply by 3.78541
   - Unknown unit → assume liters
3. **Calculate Total**: Multiply liters per bottle by net production (bottle count)

### Formula
```
Liters per Bottle = Convert SKU size to liters
Total Liters = Liters per Bottle × Net Production (bottles)
```

### Data Sources
- **SKU Table**: `sizeValue`, `sizeUnit`
- **Job/Production Data**: `netProduction` (number of bottles)

### Notes
- Supports multiple unit conversions (L, ml, oz, gal)
- If SKU or bottle count missing → returns 0

---

## 3. KWH per 8 oz Case

### Purpose
Measures energy efficiency per standard 8 oz case equivalent.

### Calculation Algorithm
1. Calculate **8 oz case equivalent** from total liters:
   - 8 oz case factor = **5.678** (conversion factor)
   - 8 oz cases = Total Liters ÷ 5.678
2. Divide total KWH by 8 oz case equivalent

### Formula
```
8 oz Cases = Total Liters ÷ 5.678
KWH per 8 oz Case = Total KWH ÷ 8 oz Cases
```

### Example
- Total Liters = 207,648 L
- 8 oz Cases = 207,648 ÷ 5.678 = 36,580.49 cases
- Total KWH = 3,218 kWH
- KWH per 8 oz Case = 3,218 ÷ 36,580.49 = **0.0880 kWH/case**

### Notes
- **5.678** is the conversion factor for 8 oz case to liters
- If total liters = 0 → returns 0
- Result rounded to 4 decimal places

---

## 4. KWH per Pack

### Purpose
Measures energy consumption per production pack/case.

### Calculation Algorithm
1. Get cases count from job/production data
2. Divide total KWH by cases count

### Formula
```
KWH per Pack = Total KWH ÷ Cases Count
```

### Example
- Total KWH = 3,218 kWH
- Cases Count = 28,840 cases
- KWH per Pack = 3,218 ÷ 28,840 = **0.1116 kWH/pack**

### Notes
- Uses `casesCount` from job/production data
- If cases count = 0 → returns 0
- Result rounded to 4 decimal places

---

## 5. Volume of Diesel

### Purpose
User input for diesel volume used during production.

### Calculation Algorithm
- **User Input**: Stored per report in database
- **Default Value**: 0 if not set
- **Editable**: User can update and save via UI

### Formula
```
Volume of Diesel = User Input (stored in Reports.volumeOfDiesel)
```

### Data Sources
- **Reports Table**: `volumeOfDiesel` column (DECIMAL 10,2)
- User input via frontend form

### Notes
- Stored per report (not per job)
- Default = 0
- User can save/update via "SAVE" button
- Result rounded to 2 decimal places

---

## 6. Price per Liter (at job start)

### Purpose
Retrieves the diesel price per liter that was active when the job started.

### Calculation Algorithm
1. **Find Generators**:
   - **Method 1**: Find generators connected to meters at line's location (via GeneratorMeters table)
   - **Method 2 (Fallback)**: Find generators directly by `locationId` if no meter connections exist
2. **Select Generator**: Use first generator found (TODO: future enhancement - use generator with most consumption)
3. **Get Tariff Type**: Extract `tariffTypeId` from selected generator
4. **Find Active TariffUsage**:
   - Find TariffUsage where:
     - `startDate ≤ job.actualStartTime`
     - `endDate ≥ job.actualStartTime`
     - Tariff `typeId` = generator's `tariffTypeId`
5. **Extract Price**: Get `pricePerLiter` from the Tariff record

### Formula
```
Price per Liter = Tariff.pricePerLiter
Where:
  - TariffUsage is active at job start time
  - Tariff.typeId matches Generator.tariffTypeId
```

### Data Sources
- **Generators Table**: `locationId`, `tariffTypeId`
- **GeneratorMeters Table**: Links generators to meters
- **Meters Table**: `locationId` (from line)
- **TariffUsage Table**: `startDate`, `endDate`, links to Tariff
- **Tariff Table**: `typeId`, `pricePerLiter`

### Notes
- Searches for active tariff at **job start time** (not current time)
- If no generator found → returns 0
- If no active TariffUsage found → returns 0
- Currently uses first generator (future: use generator with most consumption)
- Result rounded to 2 decimal places

---

## 7. Cost of KWH per Diesel

### Purpose
Calculates the cost per KWH of diesel used for energy generation.

### Calculation Algorithm
1. Get price per liter (from calculation #6 - fetched from TariffUsage at job start)
2. Get volume of diesel (from calculation #5 - user input)
3. Get total KWH consumption (from calculation #1)
4. Calculate: (Price per Liter × Volume of Diesel) ÷ Total KWH

### Formula
```
Cost of KWH per Diesel = (Price per Liter × Volume of Diesel) ÷ Total KWH
```

### Example
- Price per Liter = 2.50 /L
- Volume of Diesel = 23.00 L
- Total KWH = 3,218 kWH
- Cost of KWH per Diesel = (2.50 × 23.00) ÷ 3,218 = 57.50 ÷ 3,218 = **0.0179 /kWH**

### Notes
- If price per liter = 0 or volume = 0 or total KWH = 0 → returns 0
- Price per liter is fetched from **TariffUsage** active at **job start time**
- Result rounded to 2 decimal places

---

## Date-Range Reports

### Aggregation Logic
For reports spanning multiple jobs:

1. **Calculate per-job metrics** using above formulas
2. **Aggregate results**:
   - **Total KWH**: Sum of all jobs
   - **Total Liters**: Sum of all jobs
   - **KWH per 8 oz Case**: Recalculate using aggregated totals
   - **KWH per Pack**: Recalculate using aggregated totals
   - **Volume of Diesel**: From report (user input, not aggregated)
   - **Price per Liter**: From first job's start time (or most recent?)
   - **Cost of KWH per Diesel**: Recalculate using aggregated price and volume

### Formula for Date-Range
```
Aggregated KWH per 8 oz Case = (Σ Total KWH) ÷ ((Σ Total Liters) ÷ 5.678)
Aggregated KWH per Pack = (Σ Total KWH) ÷ (Σ Cases Count)
```

---

## Data Flow Summary

```
Job Data
  ↓
Line → Location ID
  ↓
Meters (receiver type) at Location
  ↓
Tags (KWH unit) on Meters
  ↓
TagValues (first & last in time range)
  ↓
Total KWH = Σ (Last - First)

SKU Data
  ↓
Size Value & Unit
  ↓
Convert to Liters per Bottle
  ↓
Total Liters = Liters per Bottle × Net Production

Generators at Location
  ↓
TariffType from Generator
  ↓
TariffUsage (active at job start)
  ↓
Price per Liter from Tariff

User Input
  ↓
Volume of Diesel (stored in Report)

Final Calculations:
  ↓
KWH per 8 oz Case = Total KWH ÷ (Total Liters ÷ 5.678)
KWH per Pack = Total KWH ÷ Cases Count
Cost of KWH per Diesel = (Price per Liter × Volume of Diesel) ÷ Total KWH
```

---

## Key Constants

- **8 oz Case Factor**: 5.678 (liters per 8 oz case)
- **Unit Conversions**:
  - 1 ml = 0.001 L
  - 1 oz = 0.0295735 L
  - 1 gal = 3.78541 L

---

## Edge Cases & Defaults

1. **No receiver meters found** → Total KWH = 0
2. **No KWH tags found** → Total KWH = 0
3. **No tag values in time range** → Tag consumption = 0 (skipped)
4. **No generators found** → Price per Liter = 0
5. **No active TariffUsage** → Price per Liter = 0
6. **No SKU data** → Total Liters = 0
7. **Cases count = 0** → KWH per Pack = 0
8. **Total Liters = 0** → KWH per 8 oz Case = 0
9. **Volume of Diesel not set** → Default = 0

---

## Questions for BA Review

1. ✅ Is the **5.678** factor correct for 8 oz case conversion?
2. ✅ Should **Price per Liter** use the first job's start time or the most recent job's start time for date-range reports?
3. ✅ Should **Volume of Diesel** be per-job or per-report? (Currently per-report)
4. ✅ When multiple generators exist, should we use the one with **most consumption** instead of first found?
5. ✅ For date-range reports, should **Price per Liter** be averaged or use a single value?
6. ✅ Are the unit conversions (ml, oz, gal) correct for your use case?

---

## Revision History
- **2025-01-XX**: Initial document created for BA review

