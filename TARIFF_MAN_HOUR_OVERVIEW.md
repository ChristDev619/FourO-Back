# Tariff & Man Hour Calculation - Business Overview

## Quick Summary for BA

The **Man Hour Management** section calculates labor efficiency and cost metrics using:
- **User Input**: Man hours worked (entered in the report)
- **Configuration**: Cost per Man Hour (set in TariffTypes page)
- **Production Data**: Cases count from the job

---

## How It Works

### Step 1: Configuration (Admin Setup)
**Location**: `/Tariffs/TariffTypes` page

Admin sets the **Cost per Man Hour** for each TariffType:
- **Diesel**: 50.00 /hr
- **Solar**: 20.00 /hr

This value is stored in the `TariffTypes` table (`costPerManHour` field).

---

### Step 2: Finding Which TariffType to Use

When calculating for a report, the system:

1. **Finds the Generator** at the line's location
2. **Gets the Generator's TariffType** (e.g., Generator G1 has `tariffTypeId = 9` = "Diesel")
3. **Uses that TariffType's `costPerManHour`** (e.g., 50.00 for Diesel)

**Important**: Uses the **same generator** that's used for "Price per Liter" in EMS section.

---

### Step 3: User Input in Report

User enters **Man Hours** worked during the job/program:
- Example: 50.00 hours
- Stored in `Reports.manHours` field
- Editable via the "Man Hours" card in the report

---

### Step 4: Calculations

The system calculates **3 metrics**:

#### 1. **Case per Man Hour** (Productivity)
```
Formula: Cases Count ÷ Man Hours
Example: 28,840 cases ÷ 50 hours = 576.80 cases/hour
```
**Meaning**: How many cases were produced per hour of labor

#### 2. **Cost per Man Hour** (Total Labor Cost)
```
Formula: Man Hours × Cost per Man Hour (from TariffType)
Example: 50 hours × 50.00 /hr = 2,500.00
```
**Meaning**: Total labor cost for the job

#### 3. **Cost per Man Hour Value** (Rate Used)
```
Shows: @ 50.00 /hr
```
**Meaning**: The cost rate that was used (from TariffType configuration)

---

## Data Flow Diagram

```
┌─────────────────────────────────────┐
│  TARIFF TYPES PAGE                  │
│  Admin sets:                        │
│  - Diesel: 50.00 /hr                │
│  - Solar: 20.00 /hr                 │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  REPORT PAGE                        │
│  1. System finds Generator           │
│     (at line's location)            │
│  2. Gets Generator's TariffType      │
│     (e.g., Diesel = ID 9)           │
│  3. Gets costPerManHour = 50.00      │
│  4. User enters Man Hours = 50       │
│  5. System calculates:               │
│     - Case/MH = Cases ÷ 50           │
│     - Cost/MH = 50 × 50.00 = 2500   │
└─────────────────────────────────────┘
```

---

## Key Points for BA

### ✅ What's Configured
- **Cost per Man Hour** is set **per TariffType** (Diesel, Solar, etc.)
- Set once in TariffTypes page, used across all reports
- Different TariffTypes can have different rates

### ✅ What's User Input
- **Man Hours** is entered **per report**
- Each report can have different man hours
- User can edit and save it in the report

### ✅ How It's Calculated
- Uses the **same generator** as EMS (Price per Liter)
- If generator is "Diesel", uses Diesel's costPerManHour
- If generator is "Solar", uses Solar's costPerManHour

### ✅ Display in Report
- **3 Cards** in "Man Hour Management" section:
  1. **Man Hours**: Input field (user enters value)
  2. **Case per Man Hour**: Calculated (Cases ÷ Man Hours)
  3. **Cost per Man Hour**: Calculated (Man Hours × Rate)

---

## Example Calculation

**Given:**
- TariffType: Diesel (costPerManHour = 50.00)
- Cases Produced: 28,840
- Man Hours Entered: 50.00

**Results:**
- **Case per Man Hour**: 28,840 ÷ 50 = **576.80**
- **Cost per Man Hour**: 50 × 50.00 = **2,500.00**
- **Rate Used**: **@ 50.00 /hr**

---

## Database Tables Involved

### 1. **TariffTypes** Table
- Stores `costPerManHour` per tariff type
- Example: Diesel = 50.00, Solar = 20.00

### 2. **Generators** Table
- Has `tariffTypeId` field (links to TariffType)
- Example: Generator G1 → tariffTypeId = 9 (Diesel)

### 3. **Reports** Table
- Has `manHours` field (user input)
- Example: Report 301 → manHours = 50.00

### 4. **Jobs** Table
- Has `casesCount` (from production data)
- Used in calculation: Cases ÷ Man Hours

---

## Difference from EMS

| Feature | EMS (Price per Liter) | Man Hour (Cost per Man Hour) |
|---------|----------------------|------------------------------|
| **Source** | TariffUsage → Tariff | TariffType (direct) |
| **Time-based?** | ✅ Yes (uses active TariffUsage at job start) | ❌ No (fixed value) |
| **Configuration** | Tariff table (pricePerLiter) | TariffType table (costPerManHour) |
| **Why Different?** | Fuel prices change over time | Labor rates are more stable |

---

## Current Status

✅ **Fully Implemented and Working**

- TariffTypes page: Can set costPerManHour
- Report page: Shows "Man Hour Management" section
- Calculations: Working correctly
- Display: Shows all 3 cards with correct values

**Example from your data:**
- Diesel TariffType: costPerManHour = 50.00
- Report shows: Cost per Man Hour = 2,500.00 (@ 50.00 /hr)
- Calculation: 50 hours × 50.00 = 2,500.00 ✅

---

## For BA Presentation

**Simple Explanation:**
1. Admin sets labor cost rate in TariffTypes (e.g., 50/hr for Diesel)
2. User enters hours worked in the report (e.g., 50 hours)
3. System calculates:
   - Productivity: How many cases per hour
   - Total Cost: Hours × Rate = Total labor cost
4. All displayed in "Man Hour Management" section

**Business Value:**
- Track labor productivity (cases per hour)
- Calculate total labor costs
- Compare efficiency across different jobs/programs

---

## What Each Card Means (Simple Explanation)

### Card 1: **Man Hours** (50.00 hrs)
**What it is:**
- The number of hours that workers spent on this job/program
- You enter this value manually

**What it helps you:**
- Track how much time was spent on production
- Compare time across different jobs
- Plan future jobs based on time needed

**Example:** If this job took 50 hours, you know it was a long production run.

---

### Card 2: **Case per Man Hour** (576.80)
**What it is:**
- How many cases were produced per hour of work
- Formula: Total Cases ÷ Man Hours

**What it helps you:**
- **Productivity metric** - Shows how efficient your workers are
- Higher number = More productive (more cases per hour)
- Lower number = Less productive (fewer cases per hour)

**Example:** 
- 576.80 cases/hour means workers produced 576 cases every hour
- If another job shows 800 cases/hour, that job was more efficient
- You can compare jobs to see which ones are more productive

**Business Decision:**
- If productivity is low → Investigate why (training needed? Process issues?)
- If productivity is high → Learn what made it efficient

---

### Card 3: **Cost per Man Hour** (2,500.00)
**What it is:**
- **Total labor cost** for this job/program
- Formula: Man Hours × Cost Rate (50.00/hr)
- Calculation: 50 hours × 50.00 = 2,500.00

**What it helps you:**
- **Know the total cost** of labor for this production run
- **Budget planning** - Know how much labor costs per job
- **Cost analysis** - Compare labor costs across different jobs
- **Pricing decisions** - Factor labor cost into product pricing

**Example:**
- 2,500.00 means you spent $2,500 on labor for this job
- If you produced 28,840 cases, labor cost per case = 2,500 ÷ 28,840 = $0.087 per case
- You can add this to material costs to know total production cost

**Business Decision:**
- If labor cost is too high → Find ways to reduce hours or improve efficiency
- Compare with other jobs to see if costs are reasonable
- Use for financial reporting and cost analysis

**The "@ 50.00 /hr" shown below:**
- This is the **rate** used in the calculation
- It comes from your TariffType configuration (Diesel = 50.00/hr)
- Shows you what rate was applied

**Note: Cost per Case is NOT currently displayed**
- The calculation would be: Total Labor Cost ÷ Total Cases
- Example: 2,500.00 ÷ 28,840 = $0.087 per case
- This metric is **not included** in the current implementation
- It's a useful metric that could be added if needed

---

## Real-World Example

**Scenario:**
- You produced 28,840 cases
- Workers spent 50 hours
- Labor rate: 50.00 per hour

**What the numbers tell you:**

1. **Man Hours (50.00):**
   - "We worked 50 hours on this job"

2. **Case per Man Hour (576.80):**
   - "We produced 576 cases every hour"
   - "This is our productivity rate"

3. **Cost per Man Hour (2,500.00):**
   - "We spent $2,500 on labor for this job"
   - "This is our total labor cost"
   - "Each case cost $0.087 in labor (2,500 ÷ 28,840)"

**How this helps:**
- If next job takes 60 hours but produces same cases → Less efficient, higher cost
- If next job takes 40 hours for same cases → More efficient, lower cost
- You can track trends and improve over time

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-15  
**Status**: ✅ Complete and Working

