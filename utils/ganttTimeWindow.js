/**
 * Gantt Time Window Utility
 * Provides safe, validated time window parsing for Gantt charts
 * 
 * USAGE:
 *   const { hoursBack, isValid, error } = parseGanttTimeWindow(req.query.hoursBack);
 *   if (!isValid) {
 *       console.log('Invalid zoom parameter, using default:', error);
 *   }
 */

const GANTT_ZOOM_CONFIG = {
    DEFAULT_HOURS: 4,        // Maintains current behavior
    MIN_HOURS: 0.5,          // 30 minutes minimum
    MAX_HOURS: 24,           // 24 hours maximum
    RECOMMENDED_LEVELS: [0.5, 1, 2, 4, 6, 8, 12, 24] // For frontend slider
};

/**
 * Parse and validate hoursBack parameter for Gantt zoom
 * @param {string|number|undefined} queryParam - req.query.hoursBack
 * @param {number} defaultHours - Default value if not provided (defaults to config default)
 * @returns {{ hoursBack: number, isValid: boolean, isDefault: boolean, error?: string, fallbackUsed?: boolean }}
 */
function parseGanttTimeWindow(queryParam, defaultHours = GANTT_ZOOM_CONFIG.DEFAULT_HOURS) {
    // If not provided, use default (backward compatible)
    if (queryParam === undefined || queryParam === null || queryParam === '') {
        return {
            hoursBack: defaultHours,
            isValid: true,
            isDefault: true
        };
    }

    // Parse the value
    const parsed = parseFloat(queryParam);
    
    // Validate: must be a number
    if (isNaN(parsed)) {
        return {
            hoursBack: defaultHours,
            isValid: false,
            error: `Invalid hoursBack parameter: '${queryParam}'. Must be a number.`,
            fallbackUsed: true
        };
    }

    // Validate: must be positive
    if (parsed <= 0) {
        return {
            hoursBack: defaultHours,
            isValid: false,
            error: `hoursBack must be positive. Received: ${parsed}`,
            fallbackUsed: true
        };
    }

    // Validate: must be within allowed range
    if (parsed < GANTT_ZOOM_CONFIG.MIN_HOURS || parsed > GANTT_ZOOM_CONFIG.MAX_HOURS) {
        return {
            hoursBack: defaultHours,
            isValid: false,
            error: `hoursBack must be between ${GANTT_ZOOM_CONFIG.MIN_HOURS} and ${GANTT_ZOOM_CONFIG.MAX_HOURS} hours. Received: ${parsed}`,
            fallbackUsed: true
        };
    }

    // Valid!
    return {
        hoursBack: parsed,
        isValid: true,
        isDefault: parsed === defaultHours
    };
}

/**
 * Calculate time window boundaries for Gantt queries
 * @param {Date} now - Current timestamp (from database NOW())
 * @param {number} hoursBack - Hours to look back
 * @returns {{ startTime: Date, endTime: Date, durationMs: number, hoursBack: number }}
 */
function calculateGanttTimeWindow(now, hoursBack) {
    const durationMs = hoursBack * 60 * 60 * 1000;
    const startTime = new Date(now.getTime() - durationMs);
    
    return {
        startTime,
        endTime: now,
        durationMs,
        hoursBack
    };
}

module.exports = {
    GANTT_ZOOM_CONFIG,
    parseGanttTimeWindow,
    calculateGanttTimeWindow
};
