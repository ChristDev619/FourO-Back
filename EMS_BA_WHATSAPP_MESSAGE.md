# WhatsApp Message for BA Team

---

**Subject: EMS Total Liters Calculation - Unit Conversion Question**

Hi team,

Quick question about the EMS Total Liters calculation:

**Current calculation:**
Total Number of Liters = SKU Size Value × Number of Bottles

**Issue found:**
- Most SKUs use unit "L" (Liters) ✅
- But SKU ID 40 uses unit "Gal" (Gallons) ⚠️
- Currently, we're NOT converting units - so if SKU is in Gallons, the result will be wrong

**Example:**
- SKU ID 40: sizeValue = 5.000, sizeUnit = "Gal"
- If 1,000 bottles produced → Current calc: 5,000 (but this is 5,000 Gallons, not Liters)
- Should be: 5,000 Gal × 3.78541 = 18,927 Liters

**Questions:**
1. Should we convert all units to Liters during calculation? (Gal → L, ml → L, etc.)
2. Or should all SKUs be standardized to Liters in the database?
3. What conversion factors to use? (US Gallons = 3.78541 L, UK = 4.54609 L)

**Impact:** This affects "KWH per 8 oz Case" and "Total Number of Liters Produced" display.

Please advise how to handle this. Thanks!

---

