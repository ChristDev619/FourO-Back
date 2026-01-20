# 📊 Data Gap Inspector - Documentation

## Overview

The **Data Gap Inspector** is a powerful development tool that helps you identify missing tag data (missing minutes) for production lines over a specified date range. This tool is essential for data quality assurance and helps you quickly identify gaps that need to be filled using the **MissingMin** recovery workflow.

---

## 🎯 Purpose

When your bulk tag operation system (running every 1 minute) stops or experiences issues, it creates gaps in your time-series data. The Data Gap Inspector helps you:

- ✅ **Identify** which minutes are missing data
- ✅ **Quantify** the extent of data gaps (% completeness)
- ✅ **Analyze** which specific tags are missing
- ✅ **Plan** data recovery efforts

---

## 🚀 Features

### 1. **Smart Line Selection**
- Select location using hierarchical TreeView
- Automatically fetches lines for selected location
- Shows all tags monitored for the selected line

### 2. **Flexible Date Range**
- Select any start and end date
- Maximum range: **31 days (1 month)**
- Real-time validation of date range

### 3. **Comprehensive Analysis**
- Checks **ALL tags** for the selected line
- Identifies minutes with **ANY missing tags**
- Distinguishes between:
  - **Partial gaps** (some tags missing)
  - **Complete gaps** (all tags missing)

### 4. **Clear Results Display**

**Summary Cards:**
- Total minutes expected
- Minutes with complete data
- Minutes with missing data
- Total tags monitored
- Data completeness percentage

**Detailed Table:**
- List of all minutes with gaps
- Missing tag count per minute
- Expandable rows showing specific missing tag IDs
- Pagination for large result sets

---

## 🔐 Access Control

**Environment:** **PRODUCTION READY** (accessible via direct URL)

The page is accessible in both development and production environments:
- **Development:** `http://localhost:3000/DataGapInspector`
- **Production:** `https://your-frontend-url.azurewebsites.net/DataGapInspector`

**Note:** This page is **hidden from the navigation menu** and can only be accessed via direct URL. This is intentional to keep it as a utility tool for admins/power users without cluttering the main navigation.

---

## 📖 How to Use

### Step 1: Access the Page

**Direct URL Access:**
- Development: `http://localhost:3000/DataGapInspector`
- Production: `https://your-frontend-url.azurewebsites.net/DataGapInspector`

(Not visible in navigation menu - bookmark this URL for quick access)

### Step 2: Select Location & Line

1. Click **"Click to select location"** button
2. Browse the location tree and select your desired location (e.g., Plant A)
3. Select a **Line** from the dropdown (e.g., Krones, BL2)

### Step 3: Choose Date Range

1. Select **Start Date** (e.g., January 1, 2025)
2. Select **End Date** (e.g., January 31, 2025)
3. Verify the date range is within 31 days

### Step 4: Analyze

1. Click **"Analyze Data Gaps"** button
2. Wait for the analysis to complete (may take a few seconds for large ranges)
3. Review the results

### Step 4: Interpret Results

**If Data Completeness = 100%:**
- ✅ No action needed! All data is present.

**If Data Completeness < 100%:**
- ⚠️ Review the missing minutes table
- Click on rows to expand and see which specific tags are missing
- Use this information to:
  - Export data from SCADA for those time periods
  - Use **TagConverter** → **MergeTagExcel** → **MissingMin** workflow to fill gaps

---

## 💡 Example Workflow

### Scenario: Investigate Krones Line Data Quality for January 2025

**Steps:**

1. **Open Data Gap Inspector**
   ```
   http://localhost:3000/DataGapInspector
   ```

2. **Select:**
   - Location: `Plant A - Building 1`
   - Line: `Krones`
   - Start Date: `2025-01-01`
   - End Date: `2025-01-31`

3. **Click "Analyze Data Gaps"**

4. **Results Example:**
   ```
   Total Minutes Expected: 44,640
   Complete Minutes: 44,390 (99.4%)
   Minutes with Gaps: 250 (0.6%)
   Tags Monitored: 48
   ```

5. **Action:**
   - 250 minutes need recovery
   - Export SCADA data for those 250 minutes
   - Use MissingMin workflow to fill gaps

---

## 🔧 Technical Details

### Backend API

**Endpoint:** `POST /api/data-gap-inspector/analyze`

**Request Body:**
```json
{
  "lineId": 1,
  "startDate": "2025-01-01 00:00:00",
  "endDate": "2025-01-31 23:59:59"
}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "lineId": 1,
    "lineName": "Krones",
    "startDate": "2025-01-01 00:00:00",
    "endDate": "2025-01-31 23:59:59",
    "totalMinutesExpected": 44640,
    "minutesWithCompleteData": 44390,
    "minutesWithMissingData": 250,
    "totalTagsMonitored": 48,
    "dataCompleteness": 99.44
  },
  "missingMinutes": [
    {
      "timestamp": "2025-01-15 10:23:00",
      "missingTagsCount": 3,
      "totalTags": 48,
      "missingTagIds": [132, 145, 167],
      "isCompletelyMissing": false
    }
  ],
  "tagDetails": [
    {
      "id": 132,
      "name": "KL1_Filler_State",
      "ref": "state",
      "type": "machine"
    }
  ]
}
```

### How It Works

1. **Fetch Line Tags:**
   - Queries `LineMachine` → `Machine` → `Tags` relationships
   - Gets all tag IDs for the selected line

2. **Generate Expected Minutes:**
   - Creates array of all minutes in date range
   - Example: Jan 1-31 = 44,640 minutes

3. **Query TagValues:**
   - Single optimized SQL query with grouping
   - Groups by minute and tagId
   - Uses indexed `createdAt` column

4. **Identify Gaps:**
   - Compares expected vs actual data
   - Flags minutes with ANY missing tags
   - Distinguishes partial vs complete gaps

5. **Return Results:**
   - Summary statistics
   - Detailed list of missing minutes
   - Tag metadata for reference

### Database Query Performance

**Optimization:**
- Uses single grouped query instead of N queries
- Leverages indexed `createdAt` column
- Minimal memory footprint

**Estimated Query Time:**
- 1 week: < 1 second
- 1 month: 1-3 seconds
- Depends on: tag count, data volume, database performance

---

## 📋 Validation Rules

### Date Range:
- ✅ Maximum: **31 days**
- ✅ End date must be after start date
- ✅ Both dates required

### Line Selection:
- ✅ Location must be selected first
- ✅ Line must have at least 1 tag configured
- ✅ Line must exist in database

### Response Limits:
- No pagination on backend (all missing minutes returned)
- Frontend pagination: 10/25/50/100 rows per page
- No export functionality (view only)

---

## 🎨 UI Components

### Cards (Summary):
1. **Total Minutes Expected** (Blue)
2. **Complete Minutes** (Green) - with completeness %
3. **Minutes with Gaps** (Yellow/Orange) - with gap %
4. **Tags Monitored** (Purple)

### Table (Detailed):
- **Expandable rows** - click to see missing tag IDs
- **Status badges:**
  - 🔴 "All Missing" - 100% tags missing
  - 🟡 "Partial Data" - Some tags missing
- **Pagination** - handle large result sets

---

## 🔗 Integration with Other Tools

### Recommended Workflow:

```
1. Data Gap Inspector (identify gaps)
       ↓
2. Export SCADA data for missing periods
       ↓
3. TagConverter (convert SCADA IDs → APP IDs)
       ↓
4. MergeTagExcel (combine multiple files)
       ↓
5. MissingMin (upload and insert data)
       ↓
6. Data Gap Inspector (verify gaps filled) ✅
```

---

## ⚠️ Important Notes

1. **Hidden Navigation:**
   - Not shown in navbar/menu
   - Access via direct URL only
   - Bookmark the URL for convenience
   - Share URL with team members who need access

2. **Performance Considerations:**
   - Large date ranges (20+ days) may take 2-3 seconds
   - Consider analyzing in weekly chunks for very long periods
   - Database performance impacts query speed

3. **Tag Coverage:**
   - Only checks tags linked to machines
   - Meters, generators, and line-level tags are included if linked
   - Orphaned tags (not linked to machines) are NOT checked

4. **Missing Data Definition:**
   - Minute is "missing" if **ANY tag** has no data
   - Even 1 missing tag out of 50 flags the minute
   - Helps catch partial data loss scenarios

---

## 🐛 Troubleshooting

### "No tags found for this line"
- **Cause:** Line has no machines or machines have no tags
- **Solution:** Configure machines and tag mappings for the line

### "Date range cannot exceed 31 days"
- **Cause:** Selected range is too large
- **Solution:** Split analysis into monthly chunks

### "Failed to fetch lines"
- **Cause:** Invalid location or API error
- **Solution:** Check location exists and backend is running

### Page not loading / 404 error
- **Cause:** Incorrect URL or frontend not deployed
- **Solution:** Verify exact URL path `/DataGapInspector` (case-sensitive)

---

## 📊 Example Use Cases

### 1. **Weekly Data Quality Check**
- Every Monday, check previous week's data
- Identify any gaps from weekend operations
- Plan recovery if needed

### 2. **System Maintenance Recovery**
- After SCADA system maintenance
- Check data completeness during downtime
- Fill gaps using historical exports

### 3. **Production Investigation**
- Line reported issues on specific dates
- Use inspector to verify data completeness
- Correlate gaps with operational events

### 4. **Data Migration Validation**
- After migrating data from old system
- Verify all minutes transferred correctly
- Identify missing periods for re-import

---

## 🎓 Best Practices

1. **Regular Checks:**
   - Run weekly data quality checks
   - Keep historical analysis records
   - Track data completeness trends

2. **Targeted Analysis:**
   - Start with shorter periods (7 days)
   - Expand if no issues found
   - Focus on critical production periods

3. **Documentation:**
   - Document recurring gap patterns
   - Identify root causes (network, SCADA, etc.)
   - Implement preventive measures

4. **Recovery Planning:**
   - Export SCADA data regularly (daily/weekly)
   - Store backups for quick recovery
   - Test recovery workflow periodically

---

## 📞 Support

For issues or questions:
- Check troubleshooting section above
- Review backend logs: `logs/api-combined.log`
- Check browser console for frontend errors
- Verify database connectivity

---

## 🔄 Future Enhancements (Potential)

- [ ] Export results to Excel
- [ ] Auto-generate MissingMin templates
- [ ] Email alerts for low data quality
- [ ] Historical trend analysis
- [ ] Multi-line comparison
- [ ] Custom tag selection (filter specific tags)
- [ ] Data quality dashboard integration

---

## ✅ Summary

The Data Gap Inspector is a critical tool for maintaining data quality in your industrial monitoring system. Use it regularly to:
- Monitor data completeness
- Identify gaps quickly
- Plan recovery efforts
- Ensure reliable analytics and reporting

**Remember:** This tool is for **investigation only** - use the **MissingMin** workflow to actually fill the gaps!

