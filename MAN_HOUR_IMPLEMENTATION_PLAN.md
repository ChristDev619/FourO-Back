# Man Hour Implementation Plan

## Overview
This document outlines the implementation plan for adding "Man Hour" calculations to the system, based on the requirements provided.

---

## Requirements Summary

### 1. **In Tariff Page**: Add Cost of Man Hour Configuration
- Add a section in the tariff page to define the cost of a man hour
- This should be a configurable value that can be used across reports

### 2. **In Report**: Add Three New Metrics
- **Man hours**: User input (editable field, similar to Volume of Diesel)
- **Case per man hour**: Calculated = `Cases ÷ Man hours`
- **Cost per man hour**: Calculated = `Man hours × Cost of a man hour (from Tariff)`

---

## Implementation Approach

### **Option A: Global Configuration (Recommended)**
Store "Cost of Man Hour" as a global setting in the TariffType model or a separate Settings table.

**Pros:**
- Simple to implement
- Single source of truth
- Easy to update globally

**Cons:**
- Cannot have different costs per tariff type
- Less flexible

### **Option B: Per TariffType Configuration**
Add `costPerManHour` field to the `TariffType` model.

**Pros:**
- Can have different costs per tariff type (e.g., Diesel vs Solar)
- More flexible
- Follows existing pattern (like `pricePerLiter` in Tariff)

**Cons:**
- Slightly more complex
- Need to decide which TariffType to use for reports

### **Option C: Per Tariff Configuration**
Add `costPerManHour` field to the `Tariff` model.

**Pros:**
- Most flexible (can change over time)
- Can track historical changes

**Cons:**
- Most complex
- Need to find active tariff at job start time (similar to pricePerLiter)

---

## Recommended Approach: **Option B (Per TariffType)**

### Reasoning:
1. Similar to how `pricePerLiter` works in Tariff (but we use TariffType for man hour cost)
2. Allows different costs for different tariff types
3. Simpler than Option C (no time-based lookup needed)
4. More flexible than Option A

---

## Implementation Steps

### **Phase 1: Backend - Database & Models**

#### 1.1 Add `costPerManHour` to TariffType Model
**File**: `models/TariffType.model.js`

```javascript
costPerManHour: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0,
    comment: "Cost of one man hour in currency units"
}
```

#### 1.2 Create Migration
**File**: `migrations/YYYYMMDDHHMMSS-add-costPerManHour-to-tariffTypes.js`

- Add `costPerManHour` column to `TariffTypes` table
- Set default value to 0

#### 1.3 Add `manHours` to Report Model
**File**: `models/Report.model.js`

```javascript
manHours: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0,
    comment: "Man hours (user input for report calculations)"
}
```

#### 1.4 Create Migration for Report
**File**: `migrations/YYYYMMDDHHMMSS-add-manHours-to-reports.js`

- Add `manHours` column to `Reports` table
- Set default value to 0

---

### **Phase 2: Backend - API Endpoints**

#### 2.1 Update TariffType Controller
**File**: `controllers/TariffTypeController.js`

- Update `createTariffType` to accept `costPerManHour`
- Update `updateTariffType` to allow updating `costPerManHour`
- No new endpoints needed (use existing CRUD)

#### 2.2 Add Report Update Endpoint for Man Hours
**File**: `controllers/report.controller.js`

```javascript
exports.updateReportManHours = async (req, res) => {
    // Similar to updateReportVolumeOfDiesel
    // Updates manHours field in Report
}
```

#### 2.3 Add Route
**File**: `routes/report.routes.js`

```javascript
router.put('/:id/man-hours', reportController.updateReportManHours);
```

---

### **Phase 3: Backend - Calculation Logic**

#### 3.1 Create Man Hour Calculation Function
**File**: `controllers/report.utils.js`

```javascript
/**
 * Calculate man hour metrics for a report
 * @param {Object} deps - Dependencies (TariffType, etc.)
 * @param {Object} job - Job data
 * @param {Number} casesCount - Number of cases produced
 * @param {Number} manHours - User input for man hours
 * @returns {Object} - { casePerManHour, costPerManHour, costPerManHourValue }
 */
async function calculateManHourMetrics(deps, job, casesCount, manHours = 0) {
    // 1. Get cost per man hour from TariffType
    //    - Question: Which TariffType to use? 
    //      Option 1: Use the same TariffType as the generator used for pricePerLiter
    //      Option 2: Use a default TariffType (e.g., first one found)
    //      Option 3: Add a new field to Report to specify which TariffType to use
    
    // 2. Calculate Case per Man Hour = casesCount / manHours
    // 3. Calculate Cost per Man Hour = manHours * costPerManHour
    
    return {
        casePerManHour: manHours > 0 ? casesCount / manHours : 0,
        costPerManHour: manHours * costPerManHour,
        costPerManHourValue: costPerManHour // The tariff value used
    };
}
```

**⚠️ Important Decision Needed:**
- **Which TariffType should we use for `costPerManHour`?**
  - Same as the generator's tariffTypeId used for pricePerLiter?
  - A specific "default" TariffType?
  - A new field in Report to specify which TariffType?

#### 3.2 Integrate into Report Data Extraction
**File**: `controllers/report.controller.js`

- Call `calculateManHourMetrics` in `extractJobReportData`
- Include man hour metrics in report response

---

### **Phase 4: Frontend - Tariff Page**

#### 4.1 Add Cost Per Man Hour Field
**File**: `app/Tariffs/page.js` or `app/Tariffs/TariffTypes/page.js`

- Add input field for "Cost per Man Hour" in TariffType form
- Display existing value
- Allow create/update operations

**Location**: Add to the TariffType creation/editing form

---

### **Phase 5: Frontend - Report Page**

#### 5.1 Add Man Hour Section
**File**: `app/Reports/[id]/page.js`

Similar to EMS section, create a new "Man Hour" section with:

1. **Card 1: Man Hours** (User Input)
   - Input field (similar to Volume of Diesel)
   - Save button
   - Info icon with tooltip

2. **Card 2: Case per Man Hour**
   - Display calculated value
   - Formula: `Cases ÷ Man hours`
   - Info icon with tooltip

3. **Card 3: Cost per Man Hour**
   - Display calculated value
   - Formula: `Man hours × Cost of a man hour (Tariff)`
   - Info icon with tooltip

#### 5.2 Add State Management
- `manHours` state (from `reportData.manHours`)
- `handleSaveManHours` function (API call to update)

#### 5.3 Add API Integration
- Fetch man hour metrics in report data
- Update endpoint: `PUT /api/reports/:id/man-hours`

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    TARIFF PAGE                               │
│  Admin sets "Cost per Man Hour" in TariffType               │
│  (e.g., TariffType "Diesel" → costPerManHour = 50)          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    REPORT PAGE                               │
│  1. User inputs "Man Hours" (e.g., 8.5 hours)              │
│  2. System fetches:                                          │
│     - Cases Count from job (e.g., 28,840 cases)            │
│     - Cost per Man Hour from TariffType (e.g., 50)          │
│  3. System calculates:                                       │
│     - Case per Man Hour = 28,840 ÷ 8.5 = 3,392.94          │
│     - Cost per Man Hour = 8.5 × 50 = 425                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema Changes

### **TariffTypes Table**
```sql
ALTER TABLE TariffTypes 
ADD COLUMN costPerManHour DECIMAL(10, 2) DEFAULT 0 
COMMENT 'Cost of one man hour in currency units';
```

### **Reports Table**
```sql
ALTER TABLE Reports 
ADD COLUMN manHours DECIMAL(10, 2) DEFAULT 0 
COMMENT 'Man hours (user input for report calculations)';
```

---

## API Endpoints

### **Existing (No Changes Needed)**
- `GET /api/tariff-types` - Returns all tariff types (will include `costPerManHour`)
- `POST /api/tariff-types` - Create tariff type (accepts `costPerManHour`)
- `PUT /api/tariff-types/:id` - Update tariff type (accepts `costPerManHour`)

### **New Endpoint**
- `PUT /api/reports/:id/man-hours` - Update man hours for a report
  - **Request Body**: `{ manHours: 8.5 }`
  - **Response**: Updated report object

---

## Questions to Clarify

1. **Which TariffType should be used for `costPerManHour`?**
   - Same as the generator's tariffTypeId used in the report?
   - A specific default TariffType?
   - Should we add a field to Report to specify which TariffType to use?

2. **Should `costPerManHour` be time-based?**
   - Should it change over time (like `pricePerLiter` in Tariff)?
   - Or is it a fixed value per TariffType?

3. **Where should the Man Hour section appear in the report?**
   - As a new section (like EMS)?
   - Within an existing section?
   - Should it be collapsible?

4. **What happens if `manHours = 0`?**
   - Show 0 for calculations?
   - Show "N/A" or "-"?
   - Disable calculations?

5. **Should we validate `manHours` input?**
   - Minimum value (e.g., > 0)?
   - Maximum value?
   - Decimal precision?

---

## Similar Implementation Reference

This implementation follows the same pattern as the **EMS (Energy Management System)** section:

- **User Input**: `volumeOfDiesel` (Report model) → `manHours` (Report model)
- **Configuration**: `pricePerLiter` (Tariff) → `costPerManHour` (TariffType)
- **Calculations**: Similar structure in `report.utils.js`
- **Frontend**: Similar card-based UI in report page

---

## Estimated Implementation Time

- **Backend**: 4-6 hours
  - Database migrations: 30 min
  - Model updates: 30 min
  - Calculation logic: 1-2 hours
  - API endpoints: 1 hour
  - Testing: 1-2 hours

- **Frontend**: 4-6 hours
  - Tariff page updates: 1-2 hours
  - Report page section: 2-3 hours
  - UI/UX polish: 1 hour
  - Testing: 1 hour

**Total**: 8-12 hours

---

## Next Steps

1. **Review this plan** and provide feedback
2. **Answer the clarification questions** above
3. **Approve the approach** (Option A, B, or C)
4. **Begin implementation** once approved

---

**Document Version**: 1.0  
**Created**: 2025-01-15  
**Status**: Awaiting Approval

