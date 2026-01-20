# SKU Unit Analysis - Current State & Issue

## Summary
**Issue Found**: The system supports multiple units (L, mL, Gal, oz) but **NO conversion logic exists**. Only 'L' and 'Gal' are currently used in the database.

---

## 1. Units Supported by System Design

### From Sku Model (`models/Sku.model.js`):
```javascript
sizeUnit: {
  type: DataTypes.STRING(10),
  allowNull: true,
  defaultValue: "L",
  comment: "Size unit: L, mL, Gal, oz",  // ← System designed for 4 units
}
```

### From SQL Migration (`ADD_SIZE_COLUMNS_TO_SKUS.sql`):
```sql
ADD COLUMN sizeUnit VARCHAR(10) NULL DEFAULT 'L' 
COMMENT 'Size unit: L, mL, Gal, oz';
```

**Conclusion**: System was designed to support **4 units**: L, mL, Gal, oz

---

## 2. Current Database State

### Units Actually Used in Database:
From your SKU table query:

| Unit | Count | SKU IDs |
|------|-------|---------|
| **L** (Liters) | 20 | 21-39, 41 |
| **Gal** (Gallons) | 1 | 40 |
| **mL** | 0 | None |
| **oz** | 0 | None |

### Breakdown:
- ✅ **20 SKUs** use `'L'` (Liters) - **95% of SKUs**
- ⚠️ **1 SKU** uses `'Gal'` (Gallons) - **SKU ID 40**
- ❌ **0 SKUs** use `'mL'` (Milliliters)
- ❌ **0 SKUs** use `'oz'` (Ounces)

---

## 3. Current Calculation Logic

### Code Location: `controllers/report.utils.js` → `calculateLitersFromSku()`

**Current Implementation:**
```javascript
const sizeValue = parseFloat(sku.sizeValue);
const totalLiters = sizeValue * bottleCount;  // ← NO UNIT CONVERSION!
```

**Problem**: 
- Ignores `sizeUnit` completely
- Treats all values as if they're in the same unit
- **If SKU has `sizeUnit = 'Gal'`, the result will be wrong**

---

## 4. The Issue

### Example with SKU ID 40:
```
SKU ID: 40
sizeValue: 5.000
sizeUnit: 'Gal'
Bottles Produced: 1,000

Current Calculation:
  Total = 5.000 × 1,000 = 5,000

Problem:
  - Result shows "5,000" but this is 5,000 GALLONS, not LITERS
  - Should be: 5,000 Gal × 3.78541 = 18,927 Liters
  - Error: Results are 3.78541× too small (if expecting liters)
```

### Impact:
1. **"Total Liters Produced"** will be wrong for SKU ID 40
2. **"KWH per 8 oz Case"** calculation will be wrong:
   ```
   KWH per 8 oz Case = Total KWH ÷ (Total Liters ÷ 5.678)
   ```
   If "Total Liters" is actually in Gallons, this metric will be incorrect.

---

## 5. Codebase Search Results

### No Unit Conversion Logic Found:
- ❌ No conversion functions found
- ❌ No unit conversion utilities
- ❌ `sizeUnit` is only used for logging, not calculations
- ✅ Only place `sizeUnit` is referenced: logging in `calculateLitersFromSku()`

### Where `sizeUnit` is Used:
1. **Stored in database** (Sku model)
2. **Logged in console** (`report.utils.js` line 670)
3. **NOT used in any calculations**

---

## 6. Recommendation

### Option A: Implement Unit Conversion (Recommended)
Add conversion logic to `calculateLitersFromSku()`:

```javascript
function convertToLiters(sizeValue, sizeUnit) {
  const unit = (sizeUnit || 'L').toLowerCase();
  
  switch(unit) {
    case 'l':
    case 'liter':
    case 'liters':
      return sizeValue;  // Already in liters
      
    case 'ml':
      return sizeValue / 1000;  // Convert ml to liters
      
    case 'gal':
      return sizeValue * 3.78541;  // US Gallons to liters
      // OR: return sizeValue * 4.54609;  // UK Gallons to liters
      
    case 'oz':
      return sizeValue * 0.0295735;  // US Fluid Ounces to liters
      
    default:
      console.warn(`Unknown unit: ${sizeUnit}, assuming liters`);
      return sizeValue;
  }
}

// Then in calculateLitersFromSku:
const litersPerBottle = convertToLiters(sizeValue, sku.sizeUnit);
const totalLiters = litersPerBottle * bottleCount;
```

**Pros:**
- Handles all 4 units the system was designed for
- Future-proof if new units are added
- Corrects the issue with SKU ID 40

**Cons:**
- Need BA confirmation on conversion factors (US vs UK Gallons)

---

### Option B: Standardize Database (Simpler)
Convert all SKUs to use 'L' (Liters) in the database:

```sql
-- Convert SKU ID 40 from Gallons to Liters
UPDATE Skus 
SET sizeValue = 5.000 * 3.78541,  -- 18.927
    sizeUnit = 'L'
WHERE id = 40;
```

**Pros:**
- No code changes needed
- Simpler logic
- All data standardized

**Cons:**
- Loses original unit information
- If more SKUs with different units are added later, same issue returns

---

## 7. Questions for BA Team

1. **Which conversion factors should we use?**
   - US Gallons (1 Gal = 3.78541 L) OR UK/Imperial Gallons (1 Gal = 4.54609 L)?
   - Are there any other units we should support?

2. **Should we implement conversion logic or standardize the database?**
   - Option A: Add conversion in code (handles all units)
   - Option B: Convert all SKUs to Liters in DB (simpler)

3. **For SKU ID 40 specifically:**
   - Is 5.000 Gallons correct, or should it be stored as 18.927 Liters?

---

## 8. Current Risk Level

**Low Risk** (for now):
- Only 1 SKU (ID 40) uses 'Gal'
- 95% of SKUs use 'L' correctly
- If SKU ID 40 is not actively used in production, impact is minimal

**Medium Risk** (if SKU ID 40 is used):
- Reports will show incorrect "Total Liters"
- "KWH per 8 oz Case" will be wrong
- Users may not notice the error

**High Risk** (if more SKUs with different units are added):
- Problem will multiply
- More reports will be affected

---

## Next Steps

1. ✅ **Analysis Complete** - This document
2. ⏳ **Awaiting BA Decision** - On conversion factors and approach
3. 🔄 **Implementation** - Based on BA guidance
4. ✅ **Testing** - Verify with SKU ID 40

---

**Document Created**: 2025-01-15  
**Status**: Awaiting BA Clarification

