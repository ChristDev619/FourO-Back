# Man Hour Implementation - Clarifications & Recommendations

## Question 1: Which TariffType should be used for `costPerManHour`?

### **What I Mean:**

Currently, for **Price per Liter** calculation, we do this:

```
1. Find generators at the line's location
2. Get the generator's tariffTypeId (e.g., Generator G1 has tariffTypeId = 9 for "Diesel")
3. Use that tariffTypeId to find the active TariffUsage
4. Get pricePerLiter from the Tariff
```

**Example:**
- Line is at location 40 (Krones-Floor)
- Generator G1 is found (has `tariffTypeId = 9` which is "Diesel")
- We use TariffType ID 9 to find the active Tariff
- We get `pricePerLiter = 25` from that Tariff

### **The Question:**

For **Cost per Man Hour**, should we:
- **Option A**: Use the **SAME** generator's `tariffTypeId` (the one used for pricePerLiter)?
  - Example: If generator G1 has `tariffTypeId = 9` (Diesel), use TariffType ID 9's `costPerManHour`
  
- **Option B**: Use a **DIFFERENT** approach?
  - Example: Always use a specific default TariffType (e.g., "Diesel" or first one found)
  - Example: Add a field to Report to let user choose which TariffType to use

### **My Recommendation: Option A (Use Same Generator's TariffTypeId)**

**Why:**
1. **Consistency**: Both "Price per Liter" and "Cost per Man Hour" come from the same source (the generator used for the job)
2. **Logical**: If a job uses Diesel generators, it makes sense to use Diesel's man hour cost
3. **Simple**: No extra configuration needed
4. **Follows existing pattern**: Same as how we get pricePerLiter

**Implementation:**
```javascript
// In calculateManHourMetrics function:
// 1. Get the same generator used for pricePerLiter (already found in getPricePerLiterAtJobStart)
// 2. Use that generator's tariffTypeId
// 3. Get costPerManHour from that TariffType
const tariffType = await TariffType.findByPk(generator.tariffTypeId);
const costPerManHour = tariffType.costPerManHour || 0;
```

---

## Question 2: Should `costPerManHour` be time-based?

### **What I Mean:**

Currently, `pricePerLiter` is **time-based**:
- Each `Tariff` record has a `date` and `pricePerLiter`
- `TariffUsage` links a `Tariff` to a time period (startDate, endDate)
- When we calculate pricePerLiter, we find the active TariffUsage at the job start time
- This means pricePerLiter can change over time (e.g., 25 /L in January, 30 /L in February)

### **The Question:**

Should `costPerManHour` work the same way?
- **Option A**: **Time-based** (like pricePerLiter)
  - Each Tariff has a `costPerManHour` field
  - Cost can change over time
  - Need to find active TariffUsage at job start time
  
- **Option B**: **Fixed per TariffType** (simpler)
  - `costPerManHour` is stored in `TariffType` table
  - One value per TariffType (e.g., Diesel = 50, Solar = 50)
  - Doesn't change over time (unless admin updates it)

### **My Recommendation: Option B (Fixed per TariffType)**

**Why:**
1. **Simpler**: No need to find active TariffUsage
2. **More practical**: Man hour costs don't change as frequently as fuel prices
3. **Easier to manage**: Admin sets it once per TariffType, not per Tariff record
4. **Faster**: No time-based lookup needed

**Implementation:**
```javascript
// Simple lookup - no time-based logic needed
const tariffType = await TariffType.findByPk(generator.tariffTypeId);
const costPerManHour = tariffType.costPerManHour || 0;
```

**If you need time-based later**, we can always migrate to Option A.

---

## Question 3: Where should the Man Hour section appear in the report?

### **What I Mean:**

Currently, the report has several sections:
- General Info
- Production
- Charts
- Time Loss
- Breakdowns
- **EMS (Energy Management System)** ← This is a collapsible section with 4 cards

### **The Question:**

Where should the new "Man Hour" section go?
- **Option A**: **New separate section** (like EMS)
  - Appears after EMS section
  - Has its own collapsible header
  - Contains 3 cards (Man Hours input, Case per Man Hour, Cost per Man Hour)
  
- **Option B**: **Inside an existing section**
  - Add to "Production" section?
  - Add to "General Info" section?
  
- **Option C**: **Combine with EMS section**
  - Add Man Hour cards to the existing EMS section
  - All energy/labor metrics together

### **My Recommendation: Option A (New Separate Section)**

**Why:**
1. **Clear separation**: Man hours are about labor, not energy
2. **Consistent with EMS**: Same pattern (collapsible section with cards)
3. **Easy to find**: Users know where to look
4. **Scalable**: Can add more labor metrics later

**Visual Layout:**
```
┌─────────────────────────────────────┐
│ Energy Management System (EMS)     │ ← Collapsible
│ [4 cards: KWH metrics]              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Man Hour Management                 │ ← New Collapsible Section
│ [3 cards: Man Hours, Case/MH, Cost] │
└─────────────────────────────────────┘
```

---

## Question 4: What should happen if `manHours = 0`?

### **What I Mean:**

When the user hasn't entered man hours yet, or enters 0, what should we display?

### **The Question:**

- **Option A**: Show **0** for calculations
  - Case per Man Hour = 0 (because Cases ÷ 0 = undefined, so we show 0)
  - Cost per Man Hour = 0 (because 0 × cost = 0)
  
- **Option B**: Show **"N/A"** or **"-"**
  - More clear that calculation is not possible
  - Better UX (user knows they need to enter a value)
  
- **Option C**: Show **"Enter Man Hours"** message
  - Most user-friendly
  - Guides user to input the value

### **My Recommendation: Option B (Show "N/A" or "-")**

**Why:**
1. **Clearer**: User immediately knows calculation isn't possible
2. **Professional**: Better than showing misleading 0 values
3. **Consistent**: Similar to how other systems handle missing data

**Implementation:**
```javascript
// In calculations:
const casePerManHour = manHours > 0 
    ? (casesCount / manHours).toFixed(2) 
    : 'N/A';

const costPerManHour = manHours > 0 
    ? (manHours * costPerManHour).toFixed(2) 
    : 'N/A';
```

**Frontend Display:**
```jsx
{reportData.manHour?.casePerManHour === 'N/A' 
    ? <Typography>N/A</Typography>
    : <Typography>{reportData.manHour.casePerManHour}</Typography>
}
```

---

## Summary of Recommendations

| Question | Recommendation | Reason |
|----------|---------------|--------|
| **Q1: Which TariffType?** | Use same generator's tariffTypeId (as pricePerLiter) | Consistency, logical, simple |
| **Q2: Time-based?** | Fixed per TariffType (not time-based) | Simpler, more practical, easier to manage |
| **Q3: Where in report?** | New separate collapsible section (like EMS) | Clear separation, consistent pattern |
| **Q4: If manHours = 0?** | Show "N/A" instead of 0 | Clearer, more professional |

---

## Final Implementation Approach

Based on recommendations:

1. **Database:**
   - Add `costPerManHour` to `TariffType` table (DECIMAL, default 0)
   - Add `manHours` to `Report` table (DECIMAL, default 0)

2. **Backend Logic:**
   ```javascript
   // In calculateManHourMetrics:
   // 1. Get generator (same one used for pricePerLiter)
   // 2. Get TariffType using generator.tariffTypeId
   // 3. Get costPerManHour from TariffType
   // 4. Calculate metrics (with N/A if manHours = 0)
   ```

3. **Frontend:**
   - New "Man Hour Management" section (collapsible)
   - 3 cards: Man Hours (input), Case per Man Hour, Cost per Man Hour
   - Show "N/A" when manHours = 0

---

**Ready to proceed?** If you agree with these recommendations, I can start implementation!

