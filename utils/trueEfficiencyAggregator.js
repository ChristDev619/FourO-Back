/**
 * ========================================
 * TRUE EFFICIENCY AGGREGATOR UTILITY
 * ========================================
 * 
 * Shared utility for calculating aggregated True Efficiency across multiple jobs.
 * 
 * Uses the same logic as date range reports:
 * True Efficiency = (Σ VOT / Σ Program Duration) × 100
 * 
 * This ensures consistency between:
 * - Date Range Reports (report.controller.js)
 * - Planning Module (LineData - Actual Eff %)
 * 
 * @module utils/trueEfficiencyAggregator
 */

/**
 * Calculate aggregated True Efficiency for multiple jobs
 * 
 * Formula: (Σ valueOperatingTime / Σ programDuration) × 100
 * 
 * This is a duration-weighted average where jobs with longer program durations
 * have proportionally more impact on the final efficiency percentage.
 * 
 * @param {Array} jobs - Array of Job instances (must have: id, programId, lineId)
 * @param {Function} calculateTrueEfficiency - Function from Kpis.controller.js
 * @returns {Promise<Object>} {
 *   trueEfficiency: number (percentage),
 *   jobCount: number (successful calculations),
 *   totalVOT: number (sum of Value Operating Time),
 *   totalProgramDuration: number (sum of Program Durations),
 *   failedJobs: number (jobs that failed calculation)
 * }
 */
async function calculateAggregatedTrueEfficiency(jobs, calculateTrueEfficiency) {
  if (!jobs || jobs.length === 0) {
    return {
      trueEfficiency: 0,
      jobCount: 0,
      totalVOT: 0,
      totalProgramDuration: 0,
      failedJobs: 0
    };
  }

  // Calculate True Efficiency for each job
  const allMetrics = [];
  let failedCount = 0;

  for (const job of jobs) {
    try {
      const metrics = await calculateTrueEfficiency(
        job.programId, 
        job.id, 
        job.lineId
      );
      
      // Only include valid metrics
      if (metrics && typeof metrics.valueOperatingTime === 'number' && typeof metrics.programDuration === 'number') {
        allMetrics.push(metrics);
      } else {
        failedCount++;
        console.warn(`Job ${job.id}: Invalid metrics returned`);
      }
    } catch (error) {
      failedCount++;
      console.warn(`Job ${job.id}: Failed to calculate true efficiency -`, error.message);
    }
  }

  if (allMetrics.length === 0) {
    return {
      trueEfficiency: 0,
      jobCount: 0,
      totalVOT: 0,
      totalProgramDuration: 0,
      failedJobs: failedCount
    };
  }

  // Sum all VOTs and Program Durations
  // This is the EXACT same logic as date range reports (report.controller.js line 1104)
  const sumMetrics = (key) => allMetrics.reduce((sum, m) => sum + (parseFloat(m[key]) || 0), 0);
  
  const totalVOT = sumMetrics('valueOperatingTime');
  const totalProgramDuration = sumMetrics('programDuration');

  // Calculate aggregated True Efficiency
  // This is the EXACT same formula as date range reports (report.controller.js lines 1303-1305)
  const trueEfficiency = totalProgramDuration > 0 
    ? parseFloat(((totalVOT / totalProgramDuration) * 100).toFixed(2))
    : 0;

  return {
    trueEfficiency,
    jobCount: allMetrics.length,
    totalVOT: parseFloat(totalVOT.toFixed(2)),
    totalProgramDuration: parseFloat(totalProgramDuration.toFixed(2)),
    failedJobs: failedCount
  };
}

module.exports = {
  calculateAggregatedTrueEfficiency
};

