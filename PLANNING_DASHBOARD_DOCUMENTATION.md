# Planning Dashboard - Technical Documentation

## Overview

The Planning Dashboard is a **read-only analytics module** that aggregates data from 5 Planning module sources and computes KPIs without modifying any existing data.

### Architecture

**Backend-First Approach:**
- ✅ All calculations performed in backend
- ✅ Clean separation of concerns
- ✅ Service layer with pure business logic
- ✅ Controller layer for HTTP handling
- ✅ Frontend displays pre-computed data

---

## Data Sources

The dashboard pulls data from these 5 Planning modules:

1. **DemandForecast** - Yearly volumes and growth
2. **SeasonalityData** - Monthly distribution and seasonality factor
3. **MonthlyForecast** - Monthly volumes
4. **LineData** - Capacity data (actual & standard)
5. **PackageSummary** - Aggregated package data

---

## API Endpoints

### Base URL
```
/api/planning-dashboard
```

### 1. Health Check
**GET** `/health`

Checks if all Planning data sources are available.

**Response:**
```json
{
  "success": true,
  "status": {
    "demandForecast": true,
    "seasonalityData": true,
    "monthlyForecast": true,
    "lineData": true,
    "packageSummary": true
  },
  "message": "All Planning data sources are available"
}
```

---

### 2. Get Available Recipes
**GET** `/recipes`

Returns list of all recipes available in Planning data.

**Response:**
```json
{
  "success": true,
  "data": {
    "recipes": [
      {
        "recipeId": 1,
        "recipeName": "Water 0.6L",
        "category": "Water"
      }
    ],
    "categorizedRecipes": {
      "Water": [...]
    },
    "summary": {
      "totalRecipes": 10,
      "categories": ["Water", "Juice", "Soda"]
    }
  }
}
```

---

### 3. Get All KPIs
**GET** `/all`

Returns computed KPIs for all recipes across all years.

**Response:**
```json
{
  "success": true,
  "data": {
    "recipes": [
      {
        "recipeId": 1,
        "recipeName": "Water 0.6L",
        "category": "Water",
        "kpis": {
          "year-1": {
            "year": 2025,
            "yearLabel": "Year -1",
            "seasonalityFactor": 11.97,
            "annualVolume": 13332.00,
            "growthPercent": null,
            "annualCapacityAct": 15000.00,
            "annualCapacityStd": 17000.00,
            "annualUtilizationAct": 88.88,
            "annualUtilizationStd": 78.42,
            "peakVolume": 1250.00,
            "peakCapacityAct": 1400.00,
            "peakCapacityStd": 1600.00,
            "peakUtilizationAct": 89.29,
            "peakUtilizationStd": 78.13
          },
          "year0": { ... },
          "year1": { ... }
        }
      }
    ],
    "years": [
      { "id": "year-1", "year": 2025, "label": "Year -1", "isCurrent": true },
      { "id": "year0", "year": 2026, "label": "Year 0", "isCurrent": false }
    ],
    "summary": {
      "totalRecipes": 10,
      "categories": ["Water", "Juice"]
    }
  }
}
```

---

### 4. Get KPIs by Recipe
**GET** `/:recipeId`

Returns computed KPIs for a specific recipe.

**URL Parameters:**
- `recipeId` (integer, required) - Recipe ID

**Response:**
```json
{
  "success": true,
  "data": {
    "recipeId": 1,
    "recipeName": "Water 0.6L",
    "category": "Water",
    "kpis": { ... },
    "years": [ ... ]
  }
}
```

---

### 5. Get KPIs by Category
**GET** `/category/:categoryName`

Returns aggregated KPIs for all recipes in a category.

**URL Parameters:**
- `categoryName` (string, required) - Category name

**Response:**
```json
{
  "success": true,
  "data": {
    "category": "Water",
    "recipes": [ ... ],
    "categoryTotals": {
      "year-1": {
        "annualVolume": 50000.00,
        "annualCapacityAct": 60000.00,
        "annualUtilizationAct": 83.33
      }
    },
    "years": [ ... ]
  }
}
```

---

## KPI Calculations

### A. Seasonality Factor

**Formula:**
```
SeasonalityFactor = Max(rolling_4_month_averages)
```

**Source:** Seasonality Data - Table 2 (Rolling Averages)

**Description:** Maximum value from 12 rolling 4-month averages (one per month)

---

### B. Annual Volume

**Formula:**
```
AnnualVolume = Sum of all package-level yearly volumes for recipe
```

**Source:** Demand Forecast

**Description:** Total forecasted volume for the year

---

### C. Growth Percentage

**Formula:**
```
Growth% = ((CurrentYearVolume - PreviousYearVolume) / PreviousYearVolume) × 100
```

**Source:** Calculated from Annual Volume

**Description:** Year-over-year growth rate (null for first year)

---

### D. Annual Capacity

**Formula:**
```
AnnualCapacity = Max(MonthlyTotalCapacity) / (SeasonalityFactor / 100)
```

**Source:** Line Data (capacity) + Seasonality Data (factor)

**Types:**
- **Actual**: Uses `actualCapacityCases` from Line Data
- **Standard**: Uses `standardCapacityCases` from Line Data

---

### E. Annual Utilization

**Formula:**
```
AnnualUtilization = (AnnualVolume / AnnualCapacity) × 100
```

**Description:** Percentage of capacity used

**Color Coding:**
- 🟢 Green: ≥85% (Good)
- 🟠 Orange: 70-84% (Warning)
- 🔴 Red: <70% (Critical)

---

### F. Peak Volume

**Formula:**
```
PeakVolume = Max(monthly volumes)
```

**Source:** Monthly Forecast

**Description:** Highest monthly volume in the year

---

### G. Peak Capacity

**Formula:**
```
PeakCapacity = Max(monthly capacities)
```

**Source:** Line Data

**Types:**
- **Actual**: Uses `actualCapacityCases`
- **Standard**: Uses `standardCapacityCases`

---

### H. Peak Utilization

**Formula:**
```
PeakUtilization = (PeakVolume / PeakCapacity) × 100
```

**Description:** Utilization during peak month

---

## File Structure

```
Backend:
├── services/
│   └── planning.service.js          # Pure business logic & calculations
├── controllers/
│   └── planningDashboard.controller.js  # HTTP request handling
├── routes/
│   └── planningDashboard.routes.js      # API endpoint definitions
└── index.js                              # Route registration

Frontend:
└── app/Planning/PlanningDashboard/
    └── page.js                           # Dashboard UI (display only)
```

---

## Service Layer Functions

### planning.service.js

#### Main Functions

```javascript
fetchAllPlanningData()
// Fetches all 5 Planning data sources in parallel using Promise.all
// Returns: { demandForecast, seasonalityData, monthlyForecast, lineData, packageSummary }

calculateKPIsForRecipe(recipeId, planningData)
// Computes all KPIs for a recipe across all years
// Returns: { yearId: { seasonalityFactor, annualVolume, ... } }

getAllRecipes(planningData)
// Extracts all unique recipes from Demand Forecast
// Returns: [{ recipeId, recipeName, category }]
```

#### Calculation Functions

```javascript
calculateSeasonalityFactor(seasonalityData, recipeId, yearId)
// Returns: number (percentage)

calculateAnnualVolume(demandForecast, recipeId, yearId)
// Returns: number (volume)

calculateGrowthPercent(currentVolume, previousVolume)
// Returns: number|null (percentage)

calculateAnnualCapacity(lineData, recipeId, yearId, seasonalityFactor, capacityType)
// capacityType: 'actual' | 'standard'
// Returns: number (capacity)

calculateUtilization(volume, capacity)
// Returns: number (percentage)

calculatePeakVolume(monthlyForecast, recipeId, yearId)
// Returns: number (volume)

calculatePeakCapacity(lineData, recipeId, yearId, capacityType)
// Returns: number (capacity)
```

---

## Controller Layer Functions

### planningDashboard.controller.js

#### Endpoints

```javascript
exports.getAllKPIs(req, res)
// GET /api/planning-dashboard/all
// Returns KPIs for all recipes

exports.getKPIsByRecipe(req, res)
// GET /api/planning-dashboard/:recipeId
// Returns KPIs for specific recipe

exports.getAvailableRecipes(req, res)
// GET /api/planning-dashboard/recipes
// Returns list of available recipes

exports.getKPIsByCategory(req, res)
// GET /api/planning-dashboard/category/:categoryName
// Returns aggregated KPIs for category

exports.healthCheck(req, res)
// GET /api/planning-dashboard/health
// Checks data source availability
```

---

## Frontend Usage

### Display Only (No Calculations)

The frontend page `app/Planning/PlanningDashboard/page.js`:

✅ Fetches pre-computed data from backend
✅ Renders KPI tables
✅ Provides filtering (by recipe/SKU)
✅ Exports to Excel
✅ Shows data source health status

❌ **Does NOT perform any calculations**

---

## Error Handling

### Backend

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Stack trace (development only)"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad request (invalid input)
- `404` - Resource not found
- `500` - Internal server error
- `503` - Service unavailable (missing data sources)

### Frontend

- Shows loading spinner during data fetch
- Displays user-friendly error messages
- Checks data source health on mount
- Provides empty state with helpful guidance

---

## Performance Considerations

### Backend Optimizations

✅ **Parallel Data Fetching**: Uses `Promise.all` to fetch all 5 sources simultaneously
✅ **Single Query per Source**: Each Planning source fetched once
✅ **Pure Functions**: Calculations are stateless and cacheable
✅ **No Database Writes**: Read-only operations

### Frontend Optimizations

✅ **Fetch Once**: Data loaded once per filter change
✅ **Conditional Rendering**: Collapsed sections reduce initial render
✅ **Lazy Calculations**: Only calculates visible data

---

## Testing Checklist

### Backend Tests

- [ ] `/health` returns correct status for all data sources
- [ ] `/recipes` returns all recipes from Demand Forecast
- [ ] `/all` calculates KPIs correctly for all recipes
- [ ] `/:recipeId` returns KPIs for specific recipe
- [ ] `/category/:categoryName` aggregates category totals correctly
- [ ] Error handling for missing data sources
- [ ] Error handling for invalid recipe IDs

### Frontend Tests

- [ ] Dashboard loads without errors
- [ ] Recipe filter dropdown populates correctly
- [ ] KPI table renders all metrics
- [ ] Color coding works for utilization percentages
- [ ] Excel export includes all data
- [ ] Loading state displays during data fetch
- [ ] Empty state shows when no data available
- [ ] Data source health check displays correctly

---

## Example Usage

### 1. Check Health
```bash
curl http://localhost:3000/api/planning-dashboard/health
```

### 2. Get All Recipes
```bash
curl http://localhost:3000/api/planning-dashboard/recipes
```

### 3. Get All KPIs
```bash
curl http://localhost:3000/api/planning-dashboard/all
```

### 4. Get KPIs for Recipe
```bash
curl http://localhost:3000/api/planning-dashboard/123
```

### 5. Get KPIs for Category
```bash
curl http://localhost:3000/api/planning-dashboard/category/Water
```

---

## Troubleshooting

### "No active Demand Forecast found"
**Solution:** Create a Demand Forecast in the Planning module first.

### "Some Planning data sources are missing"
**Solution:** Complete all Planning modules (Demand Forecast, Seasonality Data, Monthly Forecast, Line Data, Package Summary).

### "Seasonality factor is 0"
**Solution:** Ensure Seasonality Data has been properly configured with monthly percentages that sum to 100%.

### "No recipes found"
**Solution:** Add recipes to Demand Forecast categories.

---

## Future Enhancements

### Potential Features

1. **Caching**: Redis cache for computed KPIs (refresh on Planning data updates)
2. **Scheduled Computation**: Pre-compute KPIs overnight for faster access
3. **Historical Comparison**: Compare KPIs across multiple saved Planning versions
4. **Alerts**: Notify when utilization exceeds thresholds
5. **PDF Export**: Export formatted PDF reports
6. **API Rate Limiting**: Prevent abuse of computation-heavy endpoints

---

## Security Considerations

✅ **Read-Only**: No database writes, zero risk of data corruption
✅ **Input Validation**: All parameters validated before processing
✅ **Error Sanitization**: Stack traces hidden in production
✅ **Access Control**: Can integrate with existing authentication middleware

---

## Maintenance

### Regular Tasks

1. **Monitor Performance**: Track API response times
2. **Log Analysis**: Review errors and warnings
3. **Data Quality**: Ensure Planning data sources remain accurate
4. **User Feedback**: Collect feedback on KPI usefulness

### Updates Required When

1. **Planning Module Changes**: If any Planning source structure changes
2. **Formula Changes**: If KPI calculation formulas are updated
3. **New Data Sources**: If additional Planning sources are added

---

## Support

For technical issues or questions:
1. Check logs in `logs/combined.log`
2. Verify Planning data sources using `/health` endpoint
3. Review this documentation
4. Contact development team

---

## Version History

**v1.0.0** - Initial Release
- All 5 Planning data sources integrated
- 12 KPI metrics calculated
- Full backend API with 5 endpoints
- Frontend dashboard with filtering and export
- Comprehensive documentation

---

## Credits

**Architecture**: Senior-level backend-first approach
**Data Flow**: Aggregation from 5 Planning modules
**Calculations**: Based on industry-standard capacity planning formulas

