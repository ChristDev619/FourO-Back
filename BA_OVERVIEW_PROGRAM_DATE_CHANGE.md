# Business Analyst Overview: Tag Date Range Change (Job to Program)

## Executive Summary

We are changing the date range calculation for specific production tags from **Job dates** (batch duration) to **Program dates** (program duration). This change affects how certain production metrics are calculated in Reports and Dashboard Cards.

---

## What Will Change

### Tags Affected
The following 5 tags will now use **Program Start Date** and **Program End Date** instead of **Job Start Date** and **Job End Date**:

1. **bc** (Bottles Count)
2. **csct** (Case Count) 
3. **pltsct** (Pallet Count)
4. **bp** (Bottles Planned)
5. **lost** (Rejected Bottles)

### Impact Summary
- **Before**: These tags calculated values from Job start time to Job end time
- **After**: These tags will calculate values from Program start date to Program end date
- **Reason**: Programs can span multiple jobs, and these production counters should reflect the entire program duration, not just individual job durations

---

## Reports Impact

### What Reports Are Affected
All **LMS Reports** (Line Management System Reports) that display production data:

- **Single Job Reports**: Reports viewing individual jobs
- **Multi-Job Reports**: Reports viewing multiple jobs (WTD, MTD, YTD, Date Range)

### What Data Will Change in Reports

#### 1. Production Metrics (Top Section)
- **Filler Count** (bc tag) - Will now count from program start to program end
- **Net Production** (csct/bc tags) - Will now count from program start to program end  
- **Bottles Lost** (lost tag) - Will now count from program start to program end
- **Cases Count** (csct tag) - Will now count from program start to program end
- **Pallets Count** (pltsct tag) - Will now count from program start to program end

#### 2. KPI Metrics Section
The following KPIs are affected because they depend on production counts:

- **VOT (Value Operating Time)** - Calculated from production count (bc tag)
- **QL (Quality Loss)** - Calculated from lost value (lost tag) and production count (bc tag)
- **NOT (Net Operating Time)** - Calculated from VOT + QL
- **True Efficiency** - Uses production count in calculations

**Note**: Other metrics like UDT (Unscheduled Downtime), GOT (Gross Operating Time), SLT (Speed Loss Time), SL (Speed Loss) are NOT affected as they use machine state tags, not production counter tags.

#### 3. Visual Charts
- **Waterfall Chart**: Will reflect updated production values
- **Pareto/Sunburst Chart**: Not directly affected (uses machine states)
- **Alarms List**: Not affected (uses job-based alarm aggregations)

### User Experience Impact
- **Reports will show different (typically higher) production values** when program duration is longer than job duration
- **KPI percentages may change** (e.g., True Efficiency, Net Efficiency) due to different production counts
- **Date Range**: The system will read tag values from Program Start Date to Program End Date for these specific tags

---

## Dashboard Cards Impact

### Which Dashboard Cards Are Affected

#### 1. Line Chart Cards (LMS Mode)
- **Card Type**: "Line Chart" 
- **Mode**: "Lms" (Line Management System mode)
- **Configuration**: Cards configured with `mode: "Lms"` and program selection

**What Changes:**
- When viewing tags: **bc, csct, pltsct, bp, lost** in LMS mode
- The chart will display data from **Program Start Date to Program End Date**
- Other tags (not in the list above) will continue using job date ranges

**User Experience:**
- Charts showing production counters (bottles, cases, pallets, lost bottles) will show more data points
- The time range on X-axis will extend to program end date
- Data will be more comprehensive, showing the entire program production cycle

#### 2. Gauge Cards (KPI Mode)
- **Card Type**: "Gauge"
- **Configuration**: Cards showing KPIs that depend on production counts

**What Changes:**
- Gauge cards displaying **VOT**, **QL**, or **True Efficiency** will show updated values
- These values are calculated from production counts (bc, lost tags) using program dates

#### 3. Other Card Types
- **Single Value Cards**: Not affected (show real-time values, not historical ranges)
- **Trend Cards**: Not affected (use date range selection, not program/job dates)
- **Bar Charts**: Not affected (use date range selection)
- **Pie Charts**: Not affected (use date range selection)
- **Sunburst Charts**: Not affected (use machine states)
- **Gantt Charts**: Not affected (use job/machine state data)

---

## Technical Details (For Reference)

### Code Changes
The following backend files are being modified:

1. **controllers/report.utils.js**
   - `getTagValuesDifference()` function
   - `getProductionCountWithFallback()` function

2. **controllers/report.controller.js**
   - `extractJobReportData()` function - Passes program dates to tag value functions

3. **controllers/Kpis.controller.js**
   - `fetchProductCountUntil()` function - Uses program dates for bc tag
   - `fetchLostValue()` function - Uses program dates for lost tag
   - All KPI calculation functions that call these functions

4. **controllers/card.controller.js**
   - `executeLineChartQuery()` function - Uses program dates for specified tags in LMS mode

### Data Flow
1. System fetches Program record (has startDate and endDate)
2. For tags: bc, csct, pltsct, bp, lost → Uses program.startDate and program.endDate
3. For all other tags → Continues using job.actualStartTime and job.actualEndTime
4. Calculations are performed using the appropriate date range

---

## Testing Recommendations

### Test Scenarios

1. **Single Job Report**
   - Create/view a report for a single job
   - Verify production counts use program dates
   - Compare values before/after change (if possible)

2. **Multi-Job Report (WTD/MTD/YTD)**
   - Create/view a report for multiple jobs
   - Verify aggregated production counts are correct
   - Check that KPIs calculate correctly

3. **Dashboard Line Chart (LMS Mode)**
   - Create a Line Chart card in LMS mode
   - Select program and tags: bc, csct, pltsct, bp, lost
   - Verify chart shows data from program start to program end
   - Verify other tags (not in list) still use job dates

4. **Gauge Cards with KPIs**
   - View Gauge cards showing VOT, QL, or True Efficiency
   - Verify values are calculated correctly with new date ranges

5. **Edge Cases**
   - Program with single job (dates should match or be close)
   - Program with multiple jobs (should show cumulative program values)
   - Programs where endDate is after job endDate (should include more data)

---

## User Communication

### What to Tell Users

**For Reports:**
> "Production metrics (Bottles Count, Cases Count, Pallets Count, Lost Bottles) in reports now calculate values from the Program start date to Program end date, instead of individual Job start/end times. This provides a more comprehensive view of production across the entire program duration."

**For Dashboard Cards:**
> "Line Chart cards in LMS mode now display production counter data (bottles, cases, pallets, lost bottles) from Program start to Program end, showing the complete production cycle for the selected program."

**For KPIs:**
> "KPI metrics that depend on production counts (VOT, Quality Loss, True Efficiency) are now calculated using program-level production data, providing more accurate efficiency metrics for the entire program."

---

## Questions & Answers

**Q: Will historical reports change?**
A: Yes, when viewed after deployment, they will recalculate using program dates. Historical data in the database is not changed.

**Q: Will this affect other tags not in the list?**
A: No, only the 5 specified tags (bc, csct, pltsct, bp, lost) are affected. All other tags continue using job dates.

**Q: What if a program has no endDate (active program)?**
A: The system should handle this gracefully. Active programs may show data up to the current time or job end date (to be confirmed in implementation).

**Q: Will this affect performance?**
A: Minimal impact expected. The queries use the same indexes, just with different date ranges.

**Q: Can users choose between job dates and program dates?**
A: No, this is a system-wide change. All affected tags will use program dates consistently.

---

## Deployment Notes

- This is a backend change only (no frontend changes required)
- Database schema is not changed
- Existing data is not modified
- Reports and cards will automatically use the new calculation logic after deployment
- Consider testing in staging environment first to verify calculations

---

## Version History
- **Date**: [To be filled]
- **Version**: 1.0
- **Author**: Development Team
- **Status**: Ready for BA Review

