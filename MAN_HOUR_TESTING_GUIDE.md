# Man Hour Feature - Testing Guide

## ✅ SQL Queries Executed Successfully
The database columns have been added. Now let's test the feature!

---

## Step-by-Step Testing Guide

### **Step 1: Configure Cost per Man Hour in TariffType**

1. **Navigate to TariffTypes Page:**
   - Go to: `/Tariffs/TariffTypes` (or click on Tariffs → Tariff Types)

2. **Update an Existing TariffType:**
   - Click the **Edit** icon on any TariffType (e.g., "Diesel" or "Solar")
   - You should see a new field: **"Cost per Man Hour"**
   - Enter a test value (e.g., `50` or `25`)
   - Click **"Update"**

3. **Verify in Database (Optional):**
   ```sql
   SELECT id, name, costPerManHour FROM TariffTypes;
   ```
   - You should see the `costPerManHour` value you entered

---

### **Step 2: Test Man Hour Section in Report**

1. **Navigate to a Report:**
   - Go to any existing report (e.g., `/Reports/[reportId]`)
   - Scroll down to find the **"Man Hour Management"** section
   - It should appear after the **"Energy Management System (EMS)"** section

2. **Test the Man Hours Input Card:**
   - You should see 3 cards:
     - **Card 1: Man Hours** (with input field)
     - **Card 2: Case per Man Hour** (calculated)
     - **Card 3: Cost per Man Hour** (calculated)
   
3. **Enter Man Hours:**
   - In the **"Man Hours"** card, enter a test value (e.g., `8.5`)
   - Click **"Save"** button
   - You should see a success message: "Man hours updated successfully"
   - The page should refresh and show updated calculations

---

### **Step 3: Verify Calculations**

After entering man hours, check the calculated values:

1. **Case per Man Hour:**
   - Should show: `Cases Count ÷ Man Hours`
   - Example: If Cases = 28,840 and Man Hours = 8.5
   - Result: `28,840 ÷ 8.5 = 3,392.94`

2. **Cost per Man Hour:**
   - Should show: `Man Hours × Cost per Man Hour (from TariffType)`
   - Example: If Man Hours = 8.5 and Cost/MH = 50
   - Result: `8.5 × 50 = 425.00`
   - Should also show: `@ 50.00 /hr` below the value

3. **Check Info Icons:**
   - Hover over the **info icons (ⓘ)** on each card
   - Tooltips should show calculation formulas and explanations

---

### **Step 4: Test Edge Cases**

#### **Test 1: Man Hours = 0**
- Set man hours to `0` and save
- **Expected Result:**
  - Case per Man Hour: Should show **"N/A"**
  - Cost per Man Hour: Should show **"N/A"**

#### **Test 2: No Generator Found**
- Use a report for a line that has no generators
- **Expected Result:**
  - Case per Man Hour: Should still calculate (if manHours > 0)
  - Cost per Man Hour: Should show **"N/A"** (no generator = no TariffType)

#### **Test 3: TariffType has costPerManHour = 0**
- Set a TariffType's `costPerManHour` to `0`
- Enter man hours in report
- **Expected Result:**
  - Case per Man Hour: Should calculate normally
  - Cost per Man Hour: Should show **"N/A"** or `0.00`

---

### **Step 5: Test Print Functionality**

1. **Click the Print Button** on the report page
2. **Verify:**
   - The Man Hour section should appear in the PDF
   - All 3 cards should be visible
   - Values should match what's on screen

---

### **Step 6: Test TariffType CRUD Operations**

#### **Create New TariffType:**
1. Click **"Add Tariff Type"**
2. Enter:
   - Name: `Test Type`
   - Cost per Man Hour: `75`
3. Click **"Create"**
4. **Verify:** New TariffType appears in the list with `costPerManHour = 75`

#### **Update TariffType:**
1. Edit any TariffType
2. Change `costPerManHour` value
3. Click **"Update"**
4. **Verify:** Value is updated in the list

---

### **Step 7: Verify Backend Logs**

Check your backend console/logs for:

1. **When loading a report:**
   ```
   🚀 [MAN HOUR] calculateManHourMetrics - START
   📋 Job ID: ...
   📋 Line ID: ...
   📋 Cases Count: ...
   📋 Man Hours (user input): ...
   ```

2. **When saving man hours:**
   - API call: `PUT /api/reports/:id/man-hours`
   - Should return success response

---

## Expected Results Summary

| Test Case | Expected Result |
|-----------|----------------|
| **Man Hours = 0** | Case/MH = "N/A", Cost/MH = "N/A" |
| **Man Hours > 0** | Both metrics calculate correctly |
| **No Generator** | Cost/MH = "N/A", Case/MH calculates if manHours > 0 |
| **costPerManHour = 0** | Cost/MH = "N/A" or 0.00 |
| **Save Man Hours** | Success message, page refreshes, calculations update |
| **Print Report** | Man Hour section appears in PDF |
| **Info Icons** | Tooltips show formulas and explanations |

---

## Troubleshooting

### **Issue: Man Hour section not showing**
- **Check:** Does `reportData.manHourMetrics` exist?
- **Solution:** Make sure the backend is returning `manHourMetrics` in the report data

### **Issue: Calculations showing 0 or wrong values**
- **Check:** 
  1. Is `manHours` saved correctly? (Check database: `SELECT manHours FROM Reports WHERE id = ?`)
  2. Does the generator have a `tariffTypeId`?
  3. Does the TariffType have `costPerManHour` set?
- **Solution:** Check backend logs for calculation details

### **Issue: "N/A" showing when it shouldn't**
- **Check:** 
  1. Is `manHours = 0`?
  2. Is there a generator for the line?
  3. Does the generator's TariffType have `costPerManHour`?
- **Solution:** Verify data in database and check backend logs

### **Issue: API endpoint not working**
- **Check:** 
  1. Is the route registered? (`PUT /api/reports/:id/man-hours`)
  2. Check browser console for errors
  3. Check backend logs for API errors
- **Solution:** Verify route is in `routes/report.routes.js`

---

## Quick Test Checklist

- [ ] TariffType page shows "Cost per Man Hour" field
- [ ] Can create TariffType with costPerManHour
- [ ] Can update TariffType costPerManHour
- [ ] Report page shows "Man Hour Management" section
- [ ] Can enter and save man hours
- [ ] Case per Man Hour calculates correctly
- [ ] Cost per Man Hour calculates correctly
- [ ] Shows "N/A" when manHours = 0
- [ ] Info icons show tooltips
- [ ] Print includes Man Hour section
- [ ] Backend logs show calculation steps

---

## Test Data Examples

### **Example 1: Normal Calculation**
- **Cases Count:** 28,840
- **Man Hours:** 8.5
- **Cost per Man Hour (TariffType):** 50
- **Expected:**
  - Case per Man Hour: `3,392.94`
  - Cost per Man Hour: `425.00`

### **Example 2: Zero Man Hours**
- **Cases Count:** 28,840
- **Man Hours:** 0
- **Expected:**
  - Case per Man Hour: `N/A`
  - Cost per Man Hour: `N/A`

### **Example 3: High Productivity**
- **Cases Count:** 50,000
- **Man Hours:** 5
- **Cost per Man Hour (TariffType):** 60
- **Expected:**
  - Case per Man Hour: `10,000.00`
  - Cost per Man Hour: `300.00`

---

**Ready to test!** Start with Step 1 and work through each step. Let me know if you encounter any issues! 🚀

