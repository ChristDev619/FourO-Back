# Total Liters Calculation - Business Logic Clarification

## Overview
This document explains how **Total Liters Produced** is calculated in the Energy Management System (EMS) section of reports, and identifies a question that needs Business Analyst (BA) clarification.

---

## Current Calculation

### Formula
```
Total Liters = SKU Size Value × Number of Bottles Produced
```

### Data Sources
1. **SKU Size Value** (`sku.sizeValue`): The size/volume of one bottle from the SKU table
2. **SKU Size Unit** (`sku.sizeUnit`): The unit of measurement (L, Gal, ml, oz, etc.)
3. **Number of Bottles** (`netProduction`): Total number of bottles produced in the job

### Example 1: SKU with Liters (L)
- **SKU ID**: 21
- **Size Value**: 0.500
- **Size Unit**: L (Liters)
- **Number of Bottles Produced**: 10,000
- **Calculation**: 0.500 × 10,000 = **5,000 Liters**

### Example 2: SKU with Gallons (Gal)
- **SKU ID**: 40
- **Size Value**: 5.000
- **Size Unit**: Gal (Gallons)
- **Number of Bottles Produced**: 1,000
- **Current Calculation**: 5.000 × 1,000 = **5,000** (but what unit is this?)

---

## ⚠️ **QUESTION FOR BA TEAM**

### Issue Identified
The system currently calculates Total Liters by simply multiplying:
- `SKU Size Value × Number of Bottles`

**However**, SKUs can have different units:
- Most SKUs use **Liters (L)**
- Some SKUs use **Gallons (Gal)** (e.g., SKU ID 40)
- Potentially other units (ml, oz, etc.)

### Current Behavior
**The system does NOT convert between units.** It treats all values the same:
- If SKU has `sizeValue = 5.000` and `sizeUnit = 'Gal'`
- It calculates: `5.000 × 1,000 bottles = 5,000`
- But this result is **5,000 Gallons**, not **5,000 Liters**

### Examples from Database

#### Example A: Liter-based SKU
```
SKU ID: 21
Size Value: 0.500
Size Unit: L
Bottles Produced: 10,000

Calculation: 0.500 × 10,000 = 5,000 Liters ✅ (Correct)
```

#### Example B: Gallon-based SKU
```
SKU ID: 40
Size Value: 5.000
Size Unit: Gal
Bottles Produced: 1,000

Current Calculation: 5.000 × 1,000 = 5,000
But: 5,000 Gallons = 18,927.05 Liters (if converted)
```

---

## Questions for BA Team

### 1. Unit Standardization
**Question**: Should all SKU sizes be stored in the same unit (e.g., always in Liters)?

**Options**:
- **Option A**: Convert all SKU sizes to Liters in the database
  - Example: SKU ID 40 should have `sizeValue = 18.927` and `sizeUnit = 'L'` instead of `5.000` and `'Gal'`
- **Option B**: Keep units as-is, but convert during calculation
  - Example: If `sizeUnit = 'Gal'`, convert to liters: `sizeValue × 3.78541` before multiplying

### 2. Conversion Factors
**Question**: If we need to convert units, what are the correct conversion factors?

**Common Conversions**:
- 1 Gallon (US) = 3.78541 Liters
- 1 Gallon (UK/Imperial) = 4.54609 Liters
- 1 Fluid Ounce (US) = 0.0295735 Liters
- 1 Milliliter = 0.001 Liters

**Which standard should we use?** (US, UK/Imperial, or other?)

### 3. Mixed Units in Reports
**Question**: If a date-range report includes jobs with different SKU units (e.g., some in Liters, some in Gallons), how should we aggregate?

**Example Scenario**:
- Job 1: SKU with 0.5L bottles → 5,000 Liters
- Job 2: SKU with 5 Gal bottles → 1,000 Gallons (18,927 Liters if converted)

**Should we**:
- Convert everything to Liters before aggregating?
- Keep original units and show separate totals?
- Something else?

### 4. Display in Reports
**Question**: How should Total Liters be displayed in the report?

**Current Display**: "Total Liters Produced: 207,648.00 L"

**If units are mixed**, should we:
- Always show in Liters (after conversion)?
- Show the unit from the SKU?
- Show both original and converted values?

---

## Recommended Approach (Pending BA Approval)

### Immediate Solution (Current)
- **No unit conversion** - Use `sizeValue × bottleCount` as-is
- **Assumption**: All SKUs should be standardized to the same unit in the database
- **Risk**: If SKU ID 40 (Gal) is used, the calculation will be incorrect

### Proposed Solution (After BA Clarification)
1. **Standardize SKU units** in the database to always use Liters (L)
2. **OR** Implement unit conversion in the calculation:
   ```
   If sizeUnit = 'Gal':
     litersPerBottle = sizeValue × 3.78541
   Else if sizeUnit = 'L':
     litersPerBottle = sizeValue
   Else if sizeUnit = 'ml':
     litersPerBottle = sizeValue ÷ 1000
   Else if sizeUnit = 'oz':
     litersPerBottle = sizeValue × 0.0295735
   
   Total Liters = litersPerBottle × Number of Bottles
   ```

---

## Impact on Other Calculations

The **Total Liters** value is used in:

1. **KWH per 8 oz Case**:
   ```
   KWH per 8 oz Case = Total KWH ÷ (Total Liters ÷ 5.678)
   ```
   - If Total Liters is incorrect (e.g., in Gallons instead of Liters), this metric will be wrong

2. **Summary Statistics**:
   - "Total Liters Produced" is displayed directly to users
   - If the value is in mixed units, it will be misleading

---

## Database Examples

### SKUs with Different Units

| SKU ID | Name | Size Value | Size Unit | Description |
|--------|------|------------|-----------|-------------|
| 21 | 1 | 0.500 | L | 0.500L |
| 25 | 5 | 2.000 | L | 2.0L |
| 40 | 1 | 5.000 | **Gal** | Gallon |
| 41 | 2 | 6.000 | L | Gallon 6L |

**Note**: SKU ID 40 uses **Gallons (Gal)**, while all others use **Liters (L)**.

---

## Next Steps

1. **BA Team**: Please review this document and provide answers to the questions above
2. **Development Team**: Will implement the solution based on BA guidance
3. **Testing**: Will verify calculations with mixed units (if applicable)

---

## Contact

For questions or clarifications, please contact the development team.

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-15  
**Status**: Awaiting BA Clarification

