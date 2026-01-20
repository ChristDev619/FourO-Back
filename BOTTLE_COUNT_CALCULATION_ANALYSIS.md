# Bottle Count & Net Efficiency Calculation Analysis

## Overview
This document analyzes how **bottle count** (net production) is calculated across the system and clarifies the difference between **cumulative OEE calculations** (Gantt OEE Curve) and **report-based calculations** (Report Net Efficiency).

---

## 1. Backend Calculations

### 1.1 Report Controller - Net Production (Date Range Aggregation)

**File:** `controllers/report.controller.js`

**Calculation Flow:**
```javascript
// Step 1: Get case count difference for the job period
const casesCount = await getTagValuesDifference(
    { Tags, TagValues, Op }, 
    line.id, 
    TagRefs.CASE_COUNT, 
    job.actualStartTime, 
    job.actualEndTime
);

// Step 2: Fetch SKU configuration
const sku = await Sku.findByPk(job.skuId);
const numberOfContainersPerPack = sku.numberOfContainersPerPack;

// Step 3: Calculate Net Production
netProduction = casesCount * numberOfContainersPerPack;
```

**Key Points:**
- Uses **first tag value >= job start** and **last tag value <= job end**
- Calculates total cases produced: `lastCaseCount - firstCaseCount`
- Converts cases to bottles: `cases × numberOfContainersPerPack`
- This is a **single aggregated value** for the entire job/date range
- Used in Report production section: `reportData.production.netProduction`

**Reference:** Lines 37-49 in `report.controller.js`

---

### 1.2 OEE Time Series Controller - Bottle Count (Cumulative Curve)

**File:** `controllers/OEETimeSeries.controller.js`

**Calculation Flow:**
```javascript
// Step 1: Get the batch start value (first case count at job start)
const firstTagValue = await TagValues.findOne({
    where: {
        tagId: tag.id,
        createdAt: { [Op.gte]: job.actualStartTime }
    },
    order: [["createdAt", "ASC"]]
});
const batchStartValue = parseInt(firstTagValue.value);

// Step 2: For each minute in the job duration
for (let minute of minuteTimestamps) {
    // Get case count value at this minute
    const lastSeenValueForMinute = minuteValueMap.get(minute.toISOString());
    
    // Calculate cumulative case count from start
    const caseCount = lastSeenValueForMinute - batchStartValue;
    
    // Convert to bottles (net production at this minute)
    const currentValue = caseCount * numberOfContainersPerPack;
    
    // Use this currentValue for OEE calculations
    const metrics = await calculateMetricsUntil(
        jobId, machineId, lineId,
        jobStartDate, minute.endOf("minute").toDate(),
        currentValue,  // <-- Bottle count used here
        designSpeedDB, lostTagValues, machineStateTagValues
    );
    
    // Store in OEETimeSeries table
    oeeTimeSeries.push({
        timestamp: minute.toISOString(),
        state: currentValue,  // <-- This is the bottle count
        oee: oee,
        availability: availability,
        performance: performance,
        quality: quality,
        bottleCount: currentValue  // Also stored separately
    });
}
```

**Key Points:**
- Calculates bottle count **at every minute** during the job
- Creates a **cumulative curve** from job start to current minute
- At minute X: `bottleCount = (caseCountAtMinuteX - caseCountAtStart) × numberOfContainersPerPack`
- Stored in `OEETimeSeries` table with `bottleCount` column
- Used for Net Efficiency curve visualization in Gantt chart

**Reference:** Lines 420-625 in `OEETimeSeries.controller.js`

---

### 1.3 OEE Time Series Service - Storage

**File:** `utils/services/OEETimeSeriesService.js`

**Storage Logic:**
```javascript
// Line 327: bottleCount is stored as point.state
await this.OEETimeSeries.bulkCreate(
    validPoints.map((point, idx) => ({
        jobId,
        minute: idx,
        timestamp: point.timestamp,
        oee: point.oee,
        availability: point.availability,
        performance: point.performance,
        quality: point.quality,
        bottleCount: point.state,  // <-- Stored from state field
    })),
    { transaction: t }
);
```

**Reference:** Lines 318-330 in `OEETimeSeriesService.js`

---

## 2. Frontend Display

### 2.1 Reports Page - Net Production Display

**File:** `FourO-Front/app/Reports/[id]/page.js`

**Display Logic:**
```javascript
// Line 2287: Display net production from report data
{
    label: "Net Production",
    value: reportData?.production?.netProduction || 0,
    bg: "#e8f0fe",
    border: "#1a73e8"
}
```

**Key Points:**
- Shows **single aggregated value** from backend
- Represents total bottles produced during the report period
- Static number, not a time series

---

### 2.2 Gantt Chart Component - Bottle Count Curve

**File:** `FourO-Front/app/(components)/ChartsForDashboard/GanttChartComponent.js`

**Display Logic:**
```javascript
// Line 380: Extract bottle count from OEE data
const bottleCounts = filtered.map(point => point.bottleCount ?? point.state);

// Lines 498-508: Display as time series line chart
{
    x: timePoints,
    y: bottleCounts,
    type: 'scatter',
    mode: 'lines+markers',
    name: 'Bottle Count',
    yaxis: 'y2',  // Secondary Y-axis
    line: { color: '#3498db', width: 2, shape: 'spline', dash: 'dot' },
    marker: { size: 5, color: '#3498db' },
    hovertemplate: `<b>Time:</b> %{x} UTC<br><b>Bottle Count:</b> %{y}<extra></extra>`
}
```

**Key Points:**
- Shows **cumulative bottle count over time**
- Updates every minute (or sampling interval)
- Displayed as a dotted line on secondary Y-axis
- Overlaid with Net Efficiency % curve

**Reference:** Lines 380, 498-508 in `GanttChartComponent.js`

---

## 3. Key Differences: Report vs Gantt OEE Curve

### 3.1 Report Net Production (Aggregated)

| Aspect | Details |
|--------|---------|
| **Type** | Single aggregated value |
| **Calculation** | `(lastCaseCount - firstCaseCount) × numberOfContainersPerPack` |
| **Time Range** | Entire job or date range |
| **Use Case** | Final production summary for reporting |
| **Display** | Static number in production metrics |
| **Backend Source** | `report.controller.js` → `getTagValuesDifference()` |
| **Frontend Location** | Reports page → Production section |

### 3.2 Gantt OEE Curve Bottle Count (Cumulative Time Series)

| Aspect | Details |
|--------|---------|
| **Type** | Time series (array of values) |
| **Calculation** | At each minute: `(caseCountAtMinute - caseCountAtStart) × numberOfContainersPerPack` |
| **Time Range** | Every minute from job start to end |
| **Use Case** | Visualize production progress over time |
| **Display** | Line chart overlaid with Net Efficiency curve |
| **Backend Source** | `OEETimeSeries.controller.js` → `calculateOEETimeSeries()` |
| **Frontend Location** | Gantt Chart → OEE Curve (if enabled) |

---

## 4. Bottle Count Formula Comparison

### Both Use the Same Core Formula:
```
Bottle Count = Case Count Difference × Containers Per Pack
```

### Where They Differ:

**Report (Single Value):**
```javascript
casesCount = lastCaseCount - firstCaseCount  // For entire period
netProduction = casesCount × numberOfContainersPerPack
```

**OEE Curve (Cumulative per Minute):**
```javascript
// At minute T:
caseCountAtT = lastSeenCaseCountAtMinuteT
caseCountFromStart = caseCountAtT - batchStartValue
bottleCountAtT = caseCountFromStart × numberOfContainersPerPack
```

---

## 5. Why Both Calculations Should Match

### Final Values Should Be Identical

The **last point** of the OEE curve bottle count should match the report's net production because:

1. **Report Net Production:**
   ```
   = (lastCaseCount - firstCaseCount) × numberOfContainersPerPack
   ```

2. **OEE Curve Last Point:**
   ```
   = (lastSeenValueAtJobEnd - batchStartValue) × numberOfContainersPerPack
   ```

3. **If matching:**
   - `lastCaseCount` === `lastSeenValueAtJobEnd`
   - `firstCaseCount` === `batchStartValue`
   - Then both calculations produce the same result!

### Verification Points

To ensure they match:

✅ **Same Tag Source:** Both use `TagRefs.CASE_COUNT` from the same line
✅ **Same Time Boundaries:** Both use `job.actualStartTime` and `job.actualEndTime`
✅ **Same SKU Config:** Both multiply by `numberOfContainersPerPack`
✅ **Same Tag Query Logic:** Both use `Op.gte` for start and `Op.lte` for end

---

## 6. Potential Discrepancies & Debugging

### If Values Don't Match, Check:

1. **Tag Value Queries:**
   - Report: Uses `getTagValuesDifference()` helper
   - OEE: Uses direct `TagValues.findOne()` queries
   - Verify both get the same first/last values

2. **Timing Issues:**
   - Check if tag values exist at exact job boundaries
   - Look for missing or delayed tag values

3. **SKU Configuration:**
   - Verify `numberOfContainersPerPack` is correct
   - Check if SKU changed during the job

4. **Counter Resets:**
   - Check for negative case count differences (counter reset)
   - OEE controller filters out negative values (lines 556-561)

5. **Sampling Intervals:**
   - OEE may use sampling (2-min or 5-min intervals) for long jobs
   - Last point should still align with job end

### Debug Queries

```sql
-- Check case count values for a specific job
SELECT tv.value, tv.createdAt
FROM TagValues tv
JOIN Tags t ON tv.tagId = t.id
WHERE t.taggableId = :lineId
  AND t.taggableType = 'line'
  AND t.ref = 'csct'  -- CASE_COUNT
  AND tv.createdAt BETWEEN :jobStart AND :jobEnd
ORDER BY tv.createdAt ASC;

-- Check first and last values
SELECT 
  (SELECT value FROM TagValues WHERE tagId = :caseCountTagId AND createdAt >= :jobStart ORDER BY createdAt ASC LIMIT 1) as firstValue,
  (SELECT value FROM TagValues WHERE tagId = :caseCountTagId AND createdAt <= :jobEnd ORDER BY createdAt DESC LIMIT 1) as lastValue;
```

---

## 7. Summary

### Bottle Count Calculation Sources

| Location | Type | Formula | Purpose |
|----------|------|---------|---------|
| **Report Controller** | Aggregated | `(last - first) × pack` | Final production summary |
| **OEE Time Series** | Cumulative | `(current - start) × pack` | Production progress curve |

### Net Efficiency Calculation Sources

| Location | Type | Formula | Purpose |
|----------|------|---------|---------|
| **Report OEE** | Single Value | `(VOT / duration) × 100` | Overall efficiency metric |
| **Gantt OEE Curve** | Time Series | `(A × P × Q) / 10000` per minute | Efficiency trend visualization |

### Key Takeaway

✅ **Both calculations use the same underlying logic**
✅ **The final OEE curve point should match the report's net production**
✅ **The only difference is aggregation vs cumulative time series**

---

## 8. Intelligent Fallback System (NEW - December 2025)

### 8.1 Multi-Line Support Enhancement

To support different line configurations (Krones with `csct`, Bardi with `bc`), an **intelligent fallback system** was implemented:

#### **Fallback Logic:**
```javascript
1. Try CASE_COUNT (csct) first
   ↓
   If found: cases × numberOfContainersPerPack = bottles
   ↓
2. If not found, fallback to BOTTLE_COUNT (bc)
   ↓
   If found: use value directly (already in bottles)
   ↓
3. If neither found: return 0 with warning
```

#### **Implementation Details:**

**New Helper Function:** `getProductionCountWithFallback()`
- Location: `controllers/report.utils.js`
- Returns: `{ bottleCount, casesCount, method, source, multiplier }`
- Automatically logs which method was used

**Updated Files:**
1. ✅ `controllers/report.utils.js` - New smart helper function
2. ✅ `controllers/report.controller.js` - Uses smart helper for reports
3. ✅ `controllers/OEETimeSeries.controller.js` - Uses fallback for OEE curve
4. ✅ Comprehensive logging added throughout

#### **Supported Line Configurations:**

| Line Type | Tag Used | Calculation | Example |
|-----------|----------|-------------|---------|
| **Krones** (L1) | `csct` (Case Count) | `cases × pack = bottles` | `1000 cases × 24 = 24,000 bottles` |
| **Bardi** (L2, L3) | `bc` (Bottle Count) | `bottles (direct)` | `24,000 bottles` |

#### **Benefits:**
- ✅ Zero breaking changes for existing lines
- ✅ Automatic support for new line types
- ✅ Clear audit trail via console logs
- ✅ Backward compatible with all existing data

---

## 9. Files Reference

### Backend
- `controllers/report.controller.js` - Report net production calculation
- `controllers/report.utils.js` - **Tag value helpers + intelligent fallback**
- `controllers/OEETimeSeries.controller.js` - **OEE curve calculation with fallback**
- `utils/services/OEETimeSeriesService.js` - OEE data storage
- `models/OEETimeSeries.model.js` - Database model
- `utils/constants/TagRefs.js` - Tag reference constants

### Frontend
- `app/Reports/[id]/page.js` - Report display
- `app/(components)/ChartsForDashboard/GanttChartComponent.js` - OEE curve display

---

**Last Updated:** December 8, 2025
**Analysis By:** AI Assistant
**Latest Enhancement:** Intelligent Fallback System (csct → bc)
