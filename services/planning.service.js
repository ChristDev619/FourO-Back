/**
 * ========================================
 * PLANNING DASHBOARD SERVICE
 * ========================================
 * 
 * Pure business logic for Planning Dashboard KPI calculations.
 * Aggregates data from 5 Planning module sources and computes all metrics.
 * 
 * Data Sources:
 * 1. DemandForecast - Yearly volumes and growth
 * 2. SeasonalityData - Monthly distribution and seasonality factor
 * 3. MonthlyForecast - Monthly volumes
 * 4. LineData - Capacity data (actual & standard)
 * 5. PackageSummary - Aggregated package data
 * 
 * @module services/planning.service
 */

const db = require('../dbInit');
const { DemandForecast, SeasonalityData, MonthlyForecast, LineData, PackageSummary } = db;

// Month configuration
const MONTHS = [
  { key: 'jan', label: 'Jan', index: 0 },
  { key: 'feb', label: 'Feb', index: 1 },
  { key: 'mar', label: 'Mar', index: 2 },
  { key: 'apr', label: 'Apr', index: 3 },
  { key: 'may', label: 'May', index: 4 },
  { key: 'jun', label: 'Jun', index: 5 },
  { key: 'jul', label: 'Jul', index: 6 },
  { key: 'aug', label: 'Aug', index: 7 },
  { key: 'sep', label: 'Sep', index: 8 },
  { key: 'oct', label: 'Oct', index: 9 },
  { key: 'nov', label: 'Nov', index: 10 },
  { key: 'dec', label: 'Dec', index: 11 },
];

/**
 * ========================================
 * MAIN SERVICE FUNCTION
 * ========================================
 */

/**
 * Fetch all active Planning data sources in parallel
 * @returns {Promise<Object>} All planning data sources
 */
const fetchAllPlanningData = async () => {
  try {
    const [demandForecast, seasonalityData, monthlyForecast, lineData, packageSummary] = await Promise.all([
      DemandForecast.findOne({ where: { isActive: true }, order: [['createdAt', 'DESC']] }),
      SeasonalityData.findOne({ where: { isActive: true }, order: [['createdAt', 'DESC']] }),
      MonthlyForecast.findOne({ where: { isActive: true }, order: [['createdAt', 'DESC']] }),
      LineData.findOne({ where: { isActive: true }, order: [['createdAt', 'DESC']] }),
      PackageSummary.findOne({ where: { isActive: true }, order: [['createdAt', 'DESC']] }),
    ]);

    return {
      demandForecast,
      seasonalityData,
      monthlyForecast,
      lineData,
      packageSummary,
    };
  } catch (error) {
    console.error('Error fetching planning data:', error);
    throw new Error('Failed to fetch planning data sources');
  }
};

/**
 * Calculate all KPIs for a specific recipe/SKU across all years
 * @param {number} recipeId - Recipe ID to calculate KPIs for
 * @param {Object} planningData - All planning data sources
 * @returns {Object} Computed KPIs by year
 */
const calculateKPIsForRecipe = (recipeId, planningData) => {
  const { demandForecast, seasonalityData, monthlyForecast, lineData, packageSummary } = planningData;

  if (!demandForecast?.forecastData?.years) {
    throw new Error('Demand Forecast data is required');
  }

  const years = demandForecast.forecastData.years;
  const kpis = {};

  years.forEach((year, index) => {
    const yearId = year.id;
    
    // A. Seasonality Factor
    const seasonalityFactor = calculateSeasonalityFactor(seasonalityData, recipeId, yearId);
    
    // B. Annual Volume
    const annualVolume = calculateAnnualVolume(demandForecast, recipeId, yearId);
    const previousYearId = index > 0 ? years[index - 1].id : null;
    const previousVolume = previousYearId ? calculateAnnualVolume(demandForecast, recipeId, previousYearId) : null;
    const growthPercent = calculateGrowthPercent(annualVolume, previousVolume);
    
    // C. Annual Capacity
    const annualCapacityAct = calculateAnnualCapacity(lineData, recipeId, yearId, seasonalityFactor, 'actual');
    const annualCapacityStd = calculateAnnualCapacity(lineData, recipeId, yearId, seasonalityFactor, 'standard');
    
    // D. Annual Utilization
    const annualUtilizationAct = calculateUtilization(annualVolume, annualCapacityAct);
    const annualUtilizationStd = calculateUtilization(annualVolume, annualCapacityStd);
    
    // E. Peak Month Metrics
    const peakVolume = calculatePeakVolume(monthlyForecast, recipeId, yearId);
    const peakCapacityAct = calculatePeakCapacity(lineData, recipeId, yearId, 'actual');
    const peakCapacityStd = calculatePeakCapacity(lineData, recipeId, yearId, 'standard');
    const peakUtilizationAct = calculateUtilization(peakVolume, peakCapacityAct);
    const peakUtilizationStd = calculateUtilization(peakVolume, peakCapacityStd);

    kpis[yearId] = {
      year: year.year,
      yearLabel: year.label,
      seasonalityFactor: formatNumber(seasonalityFactor, 2),
      annualVolume: formatNumber(annualVolume, 2),
      growthPercent: growthPercent !== null ? formatNumber(growthPercent, 2) : null,
      annualCapacityAct: formatNumber(annualCapacityAct, 2),
      annualCapacityStd: formatNumber(annualCapacityStd, 2),
      annualUtilizationAct: formatNumber(annualUtilizationAct, 2),
      annualUtilizationStd: formatNumber(annualUtilizationStd, 2),
      peakVolume: formatNumber(peakVolume, 2),
      peakCapacityAct: formatNumber(peakCapacityAct, 2),
      peakCapacityStd: formatNumber(peakCapacityStd, 2),
      peakUtilizationAct: formatNumber(peakUtilizationAct, 2),
      peakUtilizationStd: formatNumber(peakUtilizationStd, 2),
    };
  });

  return kpis;
};

/**
 * ========================================
 * A. SEASONALITY FACTOR CALCULATIONS
 * ========================================
 */

/**
 * Calculate Seasonality Factor for a recipe
 * Formula: Max of rolling 4-month averages across all 12 months
 * @param {Object} seasonalityData - Seasonality data source
 * @param {number} recipeId - Recipe ID
 * @param {string} yearId - Year identifier
 * @returns {number} Seasonality factor percentage
 */
const calculateSeasonalityFactor = (seasonalityData, recipeId, yearId) => {
  if (!seasonalityData?.seasonalityData?.packagesByYear?.[yearId]) {
    console.warn(`No seasonality data found for recipeId: ${recipeId}, yearId: ${yearId}`);
    return 0;
  }

  const yearPackages = seasonalityData.seasonalityData.packagesByYear[yearId];
  const packageData = yearPackages.find(p => 
    String(p.recipeId) === String(recipeId) || 
    Number(p.recipeId) === Number(recipeId)
  );

  if (!packageData?.monthlyValues) {
    console.warn(`No monthly values found for recipeId: ${recipeId}`);
    return 0;
  }

  // Calculate rolling 4-month averages for all 12 months
  const rollingAverages = MONTHS.map(month => {
    return calculateRollingAverage(packageData, month.key);
  }).filter(val => val !== null && val !== 0);

  if (rollingAverages.length === 0) {
    return 0;
  }

  // Seasonality Factor = MAX of all rolling averages
  return Math.max(...rollingAverages);
};

/**
 * Calculate 4-month rolling average for a specific month
 * @param {Object} packageData - Package data with monthly values
 * @param {string} monthKey - Month key (jan, feb, etc.)
 * @returns {number|null} Rolling average value
 */
const calculateRollingAverage = (packageData, monthKey) => {
  if (!packageData.monthlyValues) return null;

  const monthIndex = MONTHS.findIndex(m => m.key === monthKey);
  if (monthIndex === -1) return null;

  // Get current month + next 3 months (4 values total)
  const values = [];
  for (let i = 0; i < 4; i++) {
    const targetMonthIndex = (monthIndex + i) % 12;
    const targetMonth = MONTHS[targetMonthIndex];
    const value = parseFloat(packageData.monthlyValues[targetMonth.key]) || 0;
    values.push(value);
  }

  if (values.length === 0) return null;

  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
};

/**
 * ========================================
 * B. ANNUAL VOLUME CALCULATIONS
 * ========================================
 */

/**
 * Calculate Annual Volume for a recipe
 * Formula: Sum of all package-level yearly volumes for this recipe
 * @param {Object} demandForecast - Demand forecast data
 * @param {number} recipeId - Recipe ID
 * @param {string} yearId - Year identifier
 * @returns {number} Annual volume
 */
const calculateAnnualVolume = (demandForecast, recipeId, yearId) => {
  if (!demandForecast?.forecastData?.categories) {
    console.warn('No demand forecast categories found');
    return 0;
  }

  let totalVolume = 0;

  // Search through all categories and sum volumes for matching recipeId
  demandForecast.forecastData.categories.forEach(category => {
    if (!category.packages) return;

    category.packages.forEach(pkg => {
      const pkgRecipeId = String(pkg.recipeId);
      const targetRecipeId = String(recipeId);

      if (pkgRecipeId === targetRecipeId && pkg.yearValues?.[yearId] !== undefined) {
        const value = parseFloat(pkg.yearValues[yearId]) || 0;
        totalVolume += value;
      }
    });
  });

  return totalVolume;
};

/**
 * Calculate Growth Percentage
 * Formula: ((CurrentYearVolume - PreviousYearVolume) / PreviousYearVolume) × 100
 * @param {number} currentVolume - Current year volume
 * @param {number|null} previousVolume - Previous year volume
 * @returns {number|null} Growth percentage or null for first year
 */
const calculateGrowthPercent = (currentVolume, previousVolume) => {
  if (!previousVolume || previousVolume === 0) {
    return null; // No growth calculation for first year
  }
  return ((currentVolume - previousVolume) / previousVolume) * 100;
};

/**
 * ========================================
 * C. ANNUAL CAPACITY CALCULATIONS
 * ========================================
 */

/**
 * Calculate Annual Capacity
 * Formula: Max(Monthly Total Capacity) / (Seasonality Factor / 100)
 * @param {Object} lineData - Line data source
 * @param {number} recipeId - Recipe ID
 * @param {string} yearId - Year identifier
 * @param {number} seasonalityFactor - Seasonality factor percentage
 * @param {string} capacityType - 'actual' or 'standard'
 * @returns {number} Annual capacity
 */
const calculateAnnualCapacity = (lineData, recipeId, yearId, seasonalityFactor, capacityType = 'actual') => {
  if (seasonalityFactor === 0) {
    console.warn('Seasonality factor is 0, cannot calculate annual capacity');
    return 0;
  }

  const maxMonthlyCapacity = calculateMaxMonthlyCapacity(lineData, recipeId, yearId, capacityType);

  if (maxMonthlyCapacity === 0) {
    return 0;
  }

  // Annual Capacity = Max Monthly Capacity / (Seasonality Factor / 100)
  return maxMonthlyCapacity / (seasonalityFactor / 100);
};

/**
 * Get maximum monthly capacity across all months
 * @param {Object} lineData - Line data source
 * @param {number} recipeId - Recipe ID
 * @param {string} yearId - Year identifier
 * @param {string} capacityType - 'actual' or 'standard'
 * @returns {number} Maximum monthly capacity
 */
const calculateMaxMonthlyCapacity = (lineData, recipeId, yearId, capacityType) => {
  if (!lineData?.lineData?.lineDetailsByMonth?.[yearId]) {
    console.warn(`No line data found for yearId: ${yearId}`);
    return 0;
  }

  const capacityField = capacityType === 'actual' ? 'actualCapacityCases' : 'standardCapacityCases';
  const monthlyCapacities = [];

  MONTHS.forEach(month => {
    const monthDetails = lineData.lineData.lineDetailsByMonth[yearId][month.key];
    if (!monthDetails || !Array.isArray(monthDetails)) return;

    const capacitySum = monthDetails
      .filter(detail => String(detail.recipeId) === String(recipeId))
      .reduce((sum, detail) => sum + (parseFloat(detail[capacityField]) || 0), 0);

    if (capacitySum > 0) {
      monthlyCapacities.push(capacitySum);
    }
  });

  return monthlyCapacities.length > 0 ? Math.max(...monthlyCapacities) : 0;
};

/**
 * ========================================
 * D. UTILIZATION CALCULATIONS
 * ========================================
 */

/**
 * Calculate Utilization Percentage
 * Formula: (Volume / Capacity) × 100
 * @param {number} volume - Volume value
 * @param {number} capacity - Capacity value
 * @returns {number} Utilization percentage
 */
const calculateUtilization = (volume, capacity) => {
  if (!capacity || capacity === 0) {
    return 0;
  }
  return (volume / capacity) * 100;
};

/**
 * ========================================
 * E. PEAK MONTH CALCULATIONS
 * ========================================
 */

/**
 * Calculate Peak Volume
 * Formula: Max of all monthly volumes
 * @param {Object} monthlyForecast - Monthly forecast data
 * @param {number} recipeId - Recipe ID
 * @param {string} yearId - Year identifier
 * @returns {number} Peak volume
 */
const calculatePeakVolume = (monthlyForecast, recipeId, yearId) => {
  if (!monthlyForecast?.forecastData?.packagesByYear?.[yearId]) {
    console.warn(`No monthly forecast found for yearId: ${yearId}`);
    return 0;
  }

  const packages = monthlyForecast.forecastData.packagesByYear[yearId];
  const pkg = packages.find(p => String(p.recipeId) === String(recipeId));

  if (!pkg?.monthlyVolumes) {
    return 0;
  }

  const monthlyValues = MONTHS.map(month => 
    parseFloat(pkg.monthlyVolumes[month.key]) || 0
  );

  return monthlyValues.length > 0 ? Math.max(...monthlyValues) : 0;
};

/**
 * Calculate Peak Capacity
 * Formula: Max of all monthly capacities
 * @param {Object} lineData - Line data source
 * @param {number} recipeId - Recipe ID
 * @param {string} yearId - Year identifier
 * @param {string} capacityType - 'actual' or 'standard'
 * @returns {number} Peak capacity
 */
const calculatePeakCapacity = (lineData, recipeId, yearId, capacityType = 'actual') => {
  return calculateMaxMonthlyCapacity(lineData, recipeId, yearId, capacityType);
};

/**
 * ========================================
 * UTILITY FUNCTIONS
 * ========================================
 */

/**
 * Format number to specified decimal places
 * @param {number} value - Value to format
 * @param {number} decimals - Number of decimal places
 * @returns {number} Formatted number
 */
const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || isNaN(value)) {
    return 0;
  }
  return Number(parseFloat(value).toFixed(decimals));
};

/**
 * Get all unique recipe IDs from planning data
 * @param {Object} planningData - All planning data sources
 * @returns {Array} Array of unique recipe IDs with metadata
 */
const getAllRecipes = (planningData) => {
  const { demandForecast } = planningData;
  const recipeMap = new Map();

  if (demandForecast?.forecastData?.categories) {
    demandForecast.forecastData.categories.forEach(category => {
      if (!category.packages) return;

      category.packages.forEach(pkg => {
        if (pkg.recipeId && !recipeMap.has(pkg.recipeId)) {
          recipeMap.set(pkg.recipeId, {
            recipeId: pkg.recipeId,
            recipeName: pkg.recipeName || 'Unknown',
            category: category.name || 'Other',
          });
        }
      });
    });
  }

  return Array.from(recipeMap.values());
};

/**
 * ========================================
 * WATER TOTAL AGGREGATION
 * ========================================
 */

/**
 * Get water recipes from Demand Forecast (user's plan)
 * Only aggregates recipes that user added to their Demand Forecast
 * Filters by packageTypeId = 1 (Water) for consistency
 * @param {Object} demandForecast - Demand Forecast data
 * @returns {Promise<Array>} Array of water recipe IDs with metadata
 */
const getWaterRecipesFromDemandForecast = async (demandForecast) => {
  const waterRecipes = [];
  
  if (!demandForecast?.forecastData?.categories) {
    return [];
  }
  
  // Collect all recipe IDs from Demand Forecast
  const allRecipeIds = [];
  demandForecast.forecastData.categories.forEach(category => {
    if (category.packages && Array.isArray(category.packages)) {
      category.packages.forEach(pkg => {
        if (pkg.recipeId) {
          allRecipeIds.push(pkg.recipeId);
        }
      });
    }
  });
  
  if (allRecipeIds.length === 0) {
    return [];
  }
  
  // Fetch recipes with packageTypeId = 1 (Water) from database
  const { Recipie, PackageType } = db;
  const waterRecipesFromDB = await Recipie.findAll({
    where: { 
      id: allRecipeIds,
      packageTypeId: 1 // Filter by Water package type
    },
    include: [{
      model: PackageType,
      as: 'packageType',
      attributes: ['id', 'name']
    }],
    attributes: ['id', 'name', 'packageTypeId']
  });
  
  // Map to expected format
  waterRecipesFromDB.forEach(recipe => {
    waterRecipes.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      category: recipe.packageType?.name || 'Water',
      packageTypeId: recipe.packageTypeId
    });
  });
  
  return waterRecipes;
};

/**
 * Calculate aggregated KPIs for Water Total
 * Aggregates data ONLY for water recipes (packageTypeId = 1) in user's Demand Forecast
 * @param {Object} planningData - All planning data sources
 * @returns {Promise<Object>} Water Total KPIs by year
 */
const calculateWaterTotalKPIs = async (planningData) => {
  const { demandForecast, seasonalityData, monthlyForecast, lineData, packageSummary } = planningData;

  if (!demandForecast?.forecastData?.years) {
    throw new Error('Demand Forecast data is required');
  }

  // Get water recipes from Demand Forecast (only recipes with packageTypeId = 1)
  const waterRecipes = await getWaterRecipesFromDemandForecast(demandForecast);
  
  if (waterRecipes.length === 0) {
    throw new Error('No water recipes (packageTypeId = 1) found in Demand Forecast');
  }

  const waterRecipeIds = waterRecipes.map(r => r.recipeId);
  const years = demandForecast.forecastData.years;
  const kpis = {};

  years.forEach((year, index) => {
    const yearId = year.id;
    
    // A. Seasonality Factor (SUM of all individual seasonality factors)
    let totalSeasonalityFactor = 0;
    waterRecipeIds.forEach(recipeId => {
      const sf = calculateSeasonalityFactor(seasonalityData, recipeId, yearId);
      totalSeasonalityFactor += sf;
    });
    const seasonalityFactor = totalSeasonalityFactor;
    
    // B. Annual Volume (SUM of all water recipe volumes)
    let totalAnnualVolume = 0;
    waterRecipeIds.forEach(recipeId => {
      const volume = calculateAnnualVolume(demandForecast, recipeId, yearId);
      totalAnnualVolume += volume;
    });
    const annualVolume = totalAnnualVolume;
    
    // C. Growth % (based on aggregated volumes)
    const previousYearId = index > 0 ? years[index - 1].id : null;
    let previousTotalVolume = 0;
    if (previousYearId) {
      waterRecipeIds.forEach(recipeId => {
        const volume = calculateAnnualVolume(demandForecast, recipeId, previousYearId);
        previousTotalVolume += volume;
      });
    }
    const growthPercent = calculateGrowthPercent(annualVolume, previousYearId ? previousTotalVolume : null);
    
    // D. Peak Volume (MAX of summed monthly volumes)
    let peakVolume = 0;
    if (packageSummary?.summaryData?.packagesByYear) {
      const yearPackages = packageSummary.summaryData.packagesByYear[yearId] || [];
      
      // Sum monthly volumes across all water recipes
      const monthlyTotals = {};
      MONTHS.forEach(month => {
        monthlyTotals[month.key] = 0;
      });
      
      waterRecipeIds.forEach(recipeId => {
        const pkgData = yearPackages.find(p => p.recipeId === recipeId);
        if (pkgData?.monthlyData) {
          MONTHS.forEach(month => {
            const monthValue = pkgData.monthlyData[month.key]?.volume || 0;
            monthlyTotals[month.key] += monthValue;
          });
        }
      });
      
      // Find MAX
      peakVolume = Math.max(...Object.values(monthlyTotals));
    }
    
    // E. Peak Capacity (MAX from Package Summary total)
    let peakCapacityAct = 0;
    let peakCapacityStd = 0;
    if (packageSummary?.summaryData?.packagesByYear) {
      const yearPackages = packageSummary.summaryData.packagesByYear[yearId] || [];
      
      const monthlyCapAct = {};
      const monthlyCapStd = {};
      MONTHS.forEach(month => {
        monthlyCapAct[month.key] = 0;
        monthlyCapStd[month.key] = 0;
      });
      
      waterRecipeIds.forEach(recipeId => {
        const pkgData = yearPackages.find(p => p.recipeId === recipeId);
        if (pkgData?.monthlyData) {
          MONTHS.forEach(month => {
            const capAct = pkgData.monthlyData[month.key]?.capacityAct || 0;
            const capStd = pkgData.monthlyData[month.key]?.capacityStd || 0;
            monthlyCapAct[month.key] += capAct;
            monthlyCapStd[month.key] += capStd;
          });
        }
      });
      
      peakCapacityAct = Math.max(...Object.values(monthlyCapAct));
      peakCapacityStd = Math.max(...Object.values(monthlyCapStd));
    }
    
    // F. Annual Capacity (MAX monthly capacity / seasonality factor)
    const annualCapacityAct = seasonalityFactor > 0 
      ? peakCapacityAct / (seasonalityFactor / 100) 
      : 0;
    const annualCapacityStd = seasonalityFactor > 0 
      ? peakCapacityStd / (seasonalityFactor / 100) 
      : 0;
    
    // G. Annual Utilization
    const annualUtilizationAct = calculateUtilization(annualVolume, annualCapacityAct);
    const annualUtilizationStd = calculateUtilization(annualVolume, annualCapacityStd);
    
    // H. Peak Utilization
    const peakUtilizationAct = calculateUtilization(peakVolume, peakCapacityAct);
    const peakUtilizationStd = calculateUtilization(peakVolume, peakCapacityStd);
    
    // Store KPIs for this year
    kpis[yearId] = {
      seasonalityFactor: formatNumber(seasonalityFactor, 2),
      annualVolume: formatNumber(annualVolume, 2),
      growthPercent: growthPercent !== null ? formatNumber(growthPercent, 2) : null,
      annualCapacityAct: formatNumber(annualCapacityAct, 2),
      annualCapacityStd: formatNumber(annualCapacityStd, 2),
      annualUtilizationAct: formatNumber(annualUtilizationAct, 2),
      annualUtilizationStd: formatNumber(annualUtilizationStd, 2),
      peakVolume: formatNumber(peakVolume, 2),
      peakCapacityAct: formatNumber(peakCapacityAct, 2),
      peakCapacityStd: formatNumber(peakCapacityStd, 2),
      peakUtilizationAct: formatNumber(peakUtilizationAct, 2),
      peakUtilizationStd: formatNumber(peakUtilizationStd, 2),
    };
  });

  return {
    displayName: 'Water Total',
    packageTypeId: 1,
    recipeCount: waterRecipes.length,
    recipes: waterRecipes, // Include full recipe details for info display
    kpis,
  };
};

/**
 * ========================================
 * EXPORTS
 * ========================================
 */

module.exports = {
  fetchAllPlanningData,
  calculateKPIsForRecipe,
  getAllRecipes,
  calculateSeasonalityFactor,
  calculateAnnualVolume,
  calculateGrowthPercent,
  calculateAnnualCapacity,
  calculateUtilization,
  calculatePeakVolume,
  calculatePeakCapacity,
  calculateWaterTotalKPIs,
  getWaterRecipesFromDemandForecast,
};

