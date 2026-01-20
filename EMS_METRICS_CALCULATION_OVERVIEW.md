# EMS Metrics Calculation Overview

## Energy Management System (EMS) - 6 Key Metrics

This document provides a clear overview of how each EMS metric is calculated in the report system.

---

## 1. Total KWH Consumption

### What It Measures
Total energy consumed during the job period (from job start to job end).

### How It's Calculated
1. **Find Receiver Meters**: System finds all meters of type "receiver" at the line's location
2. **Find KWH Tags**: For each receiver meter, finds tags with unit = "kwh"
3. **Calculate Consumption per Tag**:
   - Gets the **first tag value** at or after job start time
   - Gets the **last tag value** at or before job end time
   - Consumption = Last Value - First Value
4. **Sum All Tags**: Adds up consumption from all receiver meter tags

### Formula
```
Total KWH = Σ (Last Tag Value - First Tag Value) for all receiver meter KWH tags
```

### Example
- Meter 1 KWH tag: First = 1,000, Last = 2,000 → Consumption = 1,000 kWH
- Meter 2 KWH tag: First = 500, Last = 1,500 → Consumption = 1,000 kWH
- Meter 3 KWH tag: First = 200, Last = 1,218 → Consumption = 1,018 kWH
- **Total KWH = 1,000 + 1,000 + 1,018 = 3,018 kWH**

### Data Sources
- **Meters Table**: Filter by `locationId` (from line) and `type = 'receiver'`
- **Tags Table**: Filter by `taggableType = 'meter'`, `taggableId = meter.id`, `unitId = kwh unit`
- **TagValues Table**: Filter by `tagId` and time range between job start and end

---

## 2. Total Liters Produced

### What It Measures
Total volume of product produced in liters.

### How It's Calculated
1. **Get SKU Size**: Extracts `sizeValue` from the SKU (e.g., 0.5, 0.6, 2.0)
2. **Get Bottle Count**: Uses `netProduction` (total number of bottles produced)
3. **Calculate**: Multiply size value by number of bottles

### Formula
```
Total Liters = SKU Size Value × Number of Bottles Produced
```

### Example
- SKU Size Value: 0.6 L per bottle
- Number of Bottles: 346,080
- **Total Liters = 0.6 × 346,080 = 207,648 L**

### Data Sources
- **SKU Table**: `sizeValue` field
- **Job Data**: `netProduction` (bottles produced)

### Note
- Currently, no unit conversion is applied (e.g., if SKU has `sizeUnit = 'Gal'`, it's not converted to liters)
- This is a known limitation that needs BA clarification

---

## 3. KWH per 8 oz Case

### What It Measures
Energy efficiency metric: How much energy is consumed per 8 oz case equivalent.

### How It's Calculated
1. **Get Total KWH**: From calculation #1
2. **Get Total Liters**: From calculation #2
3. **Calculate 8 oz Cases**: Divide total liters by 5,678 (conversion factor)
4. **Calculate KWH per Case**: Divide total KWH by number of 8 oz cases

### Formula
```
KWH per 8 oz Case = Total KWH ÷ (Total Liters ÷ 5,678)
```

### Example
- Total KWH: 3,218 kWH
- Total Liters: 207,648 L
- Number of 8 oz Cases: 207,648 ÷ 5,678 = 36.57 cases
- **KWH per 8 oz Case = 3,218 ÷ 36.57 = 87.99 kWH/case**

### Data Sources
- Total KWH (from calculation #1)
- Total Liters (from calculation #2)
- Conversion factor: 5,678 (fixed constant for 8 oz case to liters)

---

## 4. KWH per Pack

### What It Measures
Energy efficiency metric: How much energy is consumed per pack/case produced.

### How It's Calculated
1. **Get Total KWH**: From calculation #1
2. **Get Cases Count**: From job data (`casesCount`)
3. **Calculate**: Divide total KWH by number of packs

### Formula
```
KWH per Pack = Total KWH ÷ Cases Count
```

### Example
- Total KWH: 3,218 kWH
- Cases Count: 28,840 packs
- **KWH per Pack = 3,218 ÷ 28,840 = 0.1116 kWH/pack**

### Data Sources
- Total KWH (from calculation #1)
- **Job Data**: `casesCount` (number of packs/cases produced)

---

## 5. Price per Liter (at Job Start)

### What It Measures
The price of diesel per liter that was active when the job started.

### How It's Calculated
1. **Find Line's Location**: Gets `locationId` from the line
2. **Find Generators**: 
   - First tries to find generators connected to meters at the location
   - If not found, searches parent location and sibling locations
3. **Get Generator's Tariff Type**: Uses the generator's `tariffTypeId` (e.g., 9 for Diesel, 10 for Solar)
4. **Find Active TariffUsage**: 
   - Finds TariffUsage where `startDate ≤ jobStartTime` AND `endDate ≥ jobStartTime`
   - Filters by Tariff where `typeId = generator.tariffTypeId`
5. **Get Price**: Extracts `pricePerLiter` from the Tariff

### Formula
```
Price per Liter = Tariff.pricePerLiter
(where TariffUsage is active at job start time AND matches generator's tariffTypeId)
```

### Example
- Job Start Time: 2025-12-12 07:13:00
- Generator Found: G1 (tariffTypeId = 9 for Diesel)
- TariffUsage Found: ID 1 (2024-12-11 to 2026-12-11) → Tariff ID 6 (typeId = 9)
- Tariff Price per Liter: 25
- **Price per Liter = 25 /L**

### Data Sources
- **Line Table**: `locationId`
- **Generators Table**: `tariffTypeId`
- **TariffUsage Table**: `startDate`, `endDate`, `tariffId`
- **Tariff Table**: `typeId`, `pricePerLiter`

### Error Handling
- If no generators found → Returns 0, sends error email
- If no active TariffUsage found → Returns 0, sends error email
- All errors are logged and emailed to `christian_chindy@hotmail.com`

---

## 6. Cost of KWH per Diesel

### What It Measures
The cost per KWH of diesel used for energy generation.

### How It's Calculated
1. **Get Price per Liter**: From calculation #5
2. **Get Volume of Diesel**: User input (stored in Report table, default = 0)
3. **Get Total KWH**: From calculation #1
4. **Calculate**: (Price per Liter × Volume of Diesel) ÷ Total KWH

### Formula
```
Cost of KWH per Diesel = (Price per Liter × Volume of Diesel) ÷ Total KWH
```

### Example
- Price per Liter: 25 /L
- Volume of Diesel: 45 L
- Total KWH: 3,218 kWH
- **Cost = (25 × 45) ÷ 3,218 = 1,125 ÷ 3,218 = 0.35 /kWH**

### Data Sources
- Price per Liter (from calculation #5)
- **Report Table**: `volumeOfDiesel` (user input, editable in frontend)
- Total KWH (from calculation #1)

### User Interaction
- User can edit "Volume of Diesel" in the report page
- Click "SAVE" to update the value in the database
- Value is stored per report and persists

---

## Calculation Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    JOB DATA                                 │
│  - Job Start/End Time                                       │
│  - Line (with locationId)                                    │
│  - SKU (with sizeValue)                                     │
│  - Net Production (bottles)                                 │
│  - Cases Count                                              │
│  - Volume of Diesel (user input)                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        ↓                                       ↓
┌───────────────────┐                  ┌───────────────────┐
│  METRIC #1        │                  │  METRIC #2        │
│  Total KWH        │                  │  Total Liters     │
│  From receiver    │                  │  SKU × Bottles    │
│  meters           │                  │                   │
└───────────────────┘                  └───────────────────┘
        ↓                                       ↓
        └───────────────────┬───────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        ↓                                       ↓
┌───────────────────┐                  ┌───────────────────┐
│  METRIC #3        │                  │  METRIC #4        │
│  KWH per 8 oz     │                  │  KWH per Pack     │
│  Case             │                  │                   │
│  = KWH ÷          │                  │  = KWH ÷ Packs   │
│    (Liters/5.678)  │                  │                   │
└───────────────────┘                  └───────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    METRIC #5                                 │
│  Price per Liter (at Job Start)                              │
│  From Generators → TariffUsage → Tariff                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    METRIC #6                                 │
│  Cost of KWH per Diesel                                      │
│  = (Price/L × Volume) ÷ Total KWH                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Dependencies

### Required Data for All Metrics:
1. ✅ **Job** with start/end times
2. ✅ **Line** with `locationId`
3. ✅ **SKU** with `sizeValue`
4. ✅ **Net Production** (bottles)
5. ✅ **Cases Count**

### Additional Requirements:
- **For Total KWH**: Receiver meters with KWH tags at line's location
- **For Price per Liter**: Generators at location (or parent/sibling locations) with `tariffTypeId`, and active TariffUsage
- **For Cost of KWH per Diesel**: User must input "Volume of Diesel" (defaults to 0)

---

## Edge Cases & Error Handling

### If Total KWH = 0:
- KWH per 8 oz Case = 0
- KWH per Pack = 0
- Cost of KWH per Diesel = 0

### If Total Liters = 0:
- KWH per 8 oz Case = 0

### If Cases Count = 0:
- KWH per Pack = 0

### If Price per Liter = 0:
- Cost of KWH per Diesel = 0
- **Error email sent** to `christian_chindy@hotmail.com`

### If No Generators Found:
- Price per Liter = 0
- **Error email sent** to `christian_chindy@hotmail.com`

### If No Active TariffUsage Found:
- Price per Liter = 0
- **Error email sent** to `christian_chindy@hotmail.com`

---

## Date-Range Reports

For reports covering multiple jobs (date-range reports):

1. **Calculate per-job metrics** for each job in the date range
2. **Aggregate the results**:
   - **Total KWH**: Sum of all jobs' KWH
   - **Total Liters**: Sum of all jobs' liters
   - **KWH per 8 oz Case**: (Total KWH) ÷ ((Total Liters) ÷ 5,678)
   - **KWH per Pack**: (Total KWH) ÷ (Sum of Cases Count)
   - **Price per Liter**: Uses the first job's price per liter
   - **Cost of KWH per Diesel**: Uses the report's `volumeOfDiesel` and aggregated totals

---

## Summary Table

| Metric | Formula | Data Sources | User Input? |
|--------|---------|--------------|-------------|
| **Total KWH Consumption** | Σ (Last - First) for receiver meter tags | Meters, Tags, TagValues | No |
| **Total Liters Produced** | SKU Size × Bottles | SKU, Job | No |
| **KWH per 8 oz Case** | KWH ÷ (Liters ÷ 5,678) | Total KWH, Total Liters | No |
| **KWH per Pack** | KWH ÷ Cases Count | Total KWH, Cases Count | No |
| **Price per Liter** | From TariffUsage active at job start | Generators, TariffUsage, Tariff | No |
| **Cost of KWH per Diesel** | (Price/L × Volume) ÷ KWH | Price/L, Volume, Total KWH | Yes (Volume) |

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-15  
**Status**: Complete

