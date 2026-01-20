# EMS (Energy Management System) Section - Implementation Summary

## Overview
A new **Energy Management System (EMS)** section has been added to the Report Detail page, providing energy consumption metrics and cost analysis for production runs. This section includes 4 key performance indicators (KPIs) displayed as cards, along with additional energy information.

---

## Implementation Details

### 1. Database Changes

#### New Field Added to Reports Table
- **Field Name**: `volumeOfDiesel`
- **Type**: `DECIMAL(10, 2)`
- **Default**: `0`
- **Description**: Stores user-input volume of diesel in liters for EMS cost calculations
- **Migration File**: `20250115000000-add-volumeOfDiesel-to-reports.js`

---

## 2. Backend Implementation

### New Functions in `report.utils.js`

#### `calculateTotalKwhConsumption()`
- **Purpose**: Calculates total KWH consumption from receiver meters connected to line's machines
- **Logic**:
  1. Finds all receiver meters (`type = 'receiver'`) connected to the line's machines
  2. Gets KWH unit tags for these meters
  3. For each meter tag, calculates consumption as: `lastTagValue - firstTagValue`
  4. Sums all meter consumptions to get total KWH

#### `getPricePerLiterAtJobStart()`
- **Purpose**: Retrieves the price per liter of diesel at the start of a job
- **Logic**:
  1. Gets meters connected to line's machines
  2. Finds generators connected to these meters
  3. Gets generator's `tariffTypeId`
  4. Finds active `TariffUsage` at job start time where `tariff.typeId` matches generator's `tariffTypeId`
  5. Returns the `pricePerLiter` from that tariff
  6. **Note**: Currently uses first generator found. Future enhancement: use generator with most consumption

#### `calculateLitersFromSku()`
- **Purpose**: Converts bottle count to total liters based on SKU size
- **Logic**:
  - Gets SKU `sizeValue` and `sizeUnit`
  - Converts to liters based on unit:
    - `L` or `liter`: direct value
    - `ml`: divide by 1000
    - `oz`: multiply by 0.0295735
    - `gal`: multiply by 3.78541
  - Returns: `litersPerBottle × bottleCount`

#### `calculateEmsMetrics()`
- **Purpose**: Main function that calculates all EMS metrics for a job
- **Returns**:
  ```javascript
  {
    totalKwh: number,              // Total KWH consumption
    kwhPer8OzCase: number,         // KWH per 8 oz case
    kwhPerPack: number,            // KWH per pack
    volumeOfDiesel: number,         // User input (from report)
    costOfKwhPerDiesel: number,    // Cost calculation
    pricePerLiter: number,         // Price at job start
    totalLiters: number            // Total liters produced
  }
  ```

### Updated `report.controller.js`

#### Changes:
1. Added EMS dependencies to imports (Meters, Unit, Generator, GeneratorMeter, TariffUsage, Tariff)
2. Updated `extractJobReportData()` to calculate EMS metrics for each job
3. For **date-range reports**: Aggregates EMS metrics across all jobs
4. For **single job reports**: Calculates EMS metrics for that job
5. Added `ems` object to API response

#### New API Endpoint
- **Route**: `PUT /reports/:id/volume-of-diesel`
- **Purpose**: Updates volume of diesel for a report
- **Request Body**: `{ volumeOfDiesel: number }`
- **Response**: Updated report object

---

## 3. Frontend Implementation

### New EMS Section Component
- **Location**: Added after "Breakdowns" section in report detail page
- **Section ID**: `ems`
- **Icon**: Bolt icon (⚡)
- **Default State**: Expanded

### 4 EMS Cards

#### Card 1: kWH per 8 oz case
- **Formula**: `kwh / (number of liters / 5.678)`
- **Display**: Shows calculated value with 4 decimal places
- **Color Scheme**: Blue gradient
- **Icon**: Bolt icon

#### Card 2: kwh per pack
- **Formula**: `kwh consumed for job / number of packs`
- **Display**: Shows calculated value with 4 decimal places
- **Color Scheme**: Teal gradient
- **Icon**: Inventory icon

#### Card 3: Volume of diesel
- **Type**: User input field
- **Unit**: Liters (L)
- **Features**:
  - Editable number input
  - Save button with loading state
  - Persists to database
  - Default value: 0
- **Color Scheme**: Orange gradient
- **Icon**: Gas station icon

#### Card 4: Cost of kwh per diesel
- **Formula**: `price per liter × volume of diesel`
- **Display**: Shows calculated cost with 2 decimal places
- **Additional Info**: Displays price per liter used in calculation
- **Color Scheme**: Red gradient
- **Icon**: Calculator icon

### Additional Information Row
Displays:
- **Total kWH Consumption**: Sum of all receiver meter consumptions
- **Total Liters Produced**: Calculated from SKU size × bottle count
- **Price per Liter**: Active tariff price at job start time

### Features
- ✅ Responsive grid layout (4 cards on desktop, stacks on mobile)
- ✅ Modern gradient card designs with hover effects
- ✅ Dark/light theme support
- ✅ Integrated with print/PDF export functionality
- ✅ Real-time save functionality with user feedback
- ✅ Error handling and validation

---

## 4. Calculations Explained

### Calculation Flow

#### Step 1: Get Total KWH Consumption
```
For each receiver meter connected to line's machines:
  - Find KWH tag for meter
  - Get first TagValue at job start
  - Get last TagValue at job end
  - Consumption = lastValue - firstValue
  
Total KWH = Sum of all meter consumptions
```

#### Step 2: Calculate Total Liters
```
For each job:
  - Get SKU sizeValue and sizeUnit
  - Convert to liters per bottle
  - Total Liters = litersPerBottle × netProduction (bottles)
```

#### Step 3: Get Price Per Liter
```
- Find generators connected to line's machines (through meters)
- Get generator's tariffTypeId
- Find TariffUsage active at job.actualStartTime
- Get Tariff where typeId matches generator's tariffTypeId
- Price Per Liter = tariff.pricePerLiter
```

#### Step 4: Calculate Metrics

**kWH per 8 oz case:**
```
kwhPer8OzCase = totalKwh / (totalLiters / 5.678)
```
*Note: 5.678 is the conversion factor for 8 oz case to liters*

**kwh per pack:**
```
kwhPerPack = totalKwh / casesCount
```

**Cost of kwh per diesel:**
```
costOfKwhPerDiesel = pricePerLiter × volumeOfDiesel
```

### Aggregation for Date-Range Reports

For reports with multiple jobs:
- **Total KWH**: Sum of all jobs' KWH consumption
- **Total Liters**: Sum of all jobs' liters
- **kwhPerPack**: `totalKWH / totalCasesCount`
- **kwhPer8OzCase**: `totalKWH / (totalLiters / 5.678)`
- **Price Per Liter**: Average of all jobs' price per liter
- **Volume of Diesel**: Single value stored per report (user input)

---

## 5. Data Sources

### Energy Consumption
- **Source**: Receiver meters (`type = 'receiver'`)
- **Connection**: Meters connected to line's machines (`machineId` in line's machines)
- **Tags**: Tags with `taggableType = 'meter'` and `unitId = KWH unit`
- **Calculation Method**: Difference between first and last tag values in time range

### Price Per Liter
- **Source**: Tariff system
- **Flow**: Generator → TariffType → TariffUsage → Tariff → pricePerLiter
- **Time**: Active tariff at `job.actualStartTime`

### Production Data
- **Bottles**: From production counters (CASE_COUNT or BOTTLES_COUNT tags)
- **Cases**: From CASE_COUNT tag or calculated
- **Liters**: Calculated from SKU size × bottle count

---

## 6. User Workflow

1. **View Report**: User opens a report (job-based or date-range)
2. **See EMS Section**: EMS section displays with calculated metrics
3. **Enter Diesel Volume**: User enters volume of diesel in Card 3
4. **Save**: User clicks "Save" button
5. **Recalculation**: System recalculates "Cost of kwh per diesel" automatically
6. **Persistence**: Volume of diesel is saved to database and persists across sessions

---

## 7. Edge Cases Handled

- ✅ No receiver meters found → Returns 0 KWH
- ✅ No KWH unit found → Returns 0 KWH
- ✅ No generators found → Returns 0 for price per liter
- ✅ No active tariff at job start → Returns 0 for price per liter
- ✅ No SKU data → Returns 0 for liters
- ✅ Zero production → Prevents division by zero
- ✅ Missing tag values → Returns 0 for consumption
- ✅ Invalid user input → Validation and error messages

---

## 8. Future Enhancements (Not Implemented)

1. **Generator Selection**: Use generator with most consumption instead of first found
2. **Multiple Tariff Periods**: Handle jobs spanning multiple tariff periods
3. **Energy Efficiency Trends**: Historical comparison charts
4. **Energy per Unit Metrics**: Additional efficiency indicators
5. **Bulk Volume Update**: Update volume for multiple reports at once

---

## 9. Testing Recommendations

### Test Cases:
1. ✅ Single job report with EMS data
2. ✅ Date-range report with multiple jobs
3. ✅ Report with no receiver meters
4. ✅ Report with no generators
5. ✅ Report with missing SKU data
6. ✅ Save volume of diesel functionality
7. ✅ Print/PDF export with EMS section
8. ✅ Dark/light theme display
9. ✅ Mobile responsive layout
10. ✅ Zero production edge case

---

## 10. API Response Structure

### Single Job Report Response
```json
{
  "reportName": "Report Name",
  "general": { ... },
  "production": { ... },
  "kpis": { ... },
  "paretoData": [ ... ],
  "waterfallData": { ... },
  "alarms": [ ... ],
  "ems": {
    "totalKwh": 1250.50,
    "kwhPer8OzCase": 0.0234,
    "kwhPerPack": 0.1250,
    "volumeOfDiesel": 100.00,
    "costOfKwhPerDiesel": 500.00,
    "pricePerLiter": 5.00,
    "totalLiters": 53500.00
  }
}
```

### Date-Range Report Response
Same structure, with aggregated values across all jobs.

---

## Summary

The EMS section provides comprehensive energy consumption analysis for production reports, enabling users to:
- Track energy efficiency metrics
- Calculate energy costs
- Monitor energy consumption per production unit
- Make data-driven decisions about energy usage

All calculations follow industry-standard formulas and integrate seamlessly with the existing report system.

---

**Implementation Date**: January 2025  
**Status**: ✅ Complete and Ready for Testing

