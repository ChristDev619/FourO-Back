/**
 * Duration Converter Utility
 * 
 * SOLID Principles:
 * - Single Responsibility: Only handles time conversion logic
 * - Open/Closed: Easy to extend with new units
 * 
 * DRY: Centralized conversion logic used across the application
 * 
 * @module durationConverter
 */

/**
 * Convert duration to milliseconds
 * @param {number} duration - The duration value
 * @param {string} unit - The unit ('seconds', 'minutes', 'hours')
 * @returns {number} Duration in milliseconds
 */
function toMilliseconds(duration, unit = 'minutes') {
    if (!duration || duration <= 0) {
        return 0;
    }

    const converters = {
        seconds: (d) => d * 1000,
        minutes: (d) => d * 60 * 1000,
        hours: (d) => d * 60 * 60 * 1000,
    };

    const converter = converters[unit.toLowerCase()];
    if (!converter) {
        throw new Error(`Invalid duration unit: ${unit}. Must be 'seconds', 'minutes', or 'hours'`);
    }

    return converter(duration);
}

/**
 * Convert milliseconds to a specific unit
 * @param {number} milliseconds - Duration in milliseconds
 * @param {string} unit - Target unit ('seconds', 'minutes', 'hours')
 * @returns {number} Duration in target unit
 */
function fromMilliseconds(milliseconds, unit = 'minutes') {
    if (!milliseconds || milliseconds <= 0) {
        return 0;
    }

    const converters = {
        seconds: (ms) => Math.floor(ms / 1000),
        minutes: (ms) => Math.floor(ms / (60 * 1000)),
        hours: (ms) => Math.floor(ms / (60 * 60 * 1000)),
    };

    const converter = converters[unit.toLowerCase()];
    if (!converter) {
        throw new Error(`Invalid duration unit: ${unit}. Must be 'seconds', 'minutes', or 'hours'`);
    }

    return converter(milliseconds);
}

/**
 * Format duration for display
 * @param {number} duration - Duration value
 * @param {string} unit - Duration unit
 * @returns {string} Formatted string (e.g., "5 minutes", "2 hours")
 */
function formatDuration(duration, unit = 'minutes') {
    if (!duration || duration <= 0) {
        return 'Immediate';
    }

    const unitLabels = {
        seconds: duration === 1 ? 'second' : 'seconds',
        minutes: duration === 1 ? 'minute' : 'minutes',
        hours: duration === 1 ? 'hour' : 'hours',
    };

    const label = unitLabels[unit.toLowerCase()];
    if (!label) {
        return `${duration} ${unit}`;
    }

    return `${duration} ${label}`;
}

/**
 * Validate duration and unit
 * @param {number} duration - Duration value
 * @param {string} unit - Duration unit
 * @returns {Object} { valid: boolean, error: string }
 */
function validateDuration(duration, unit) {
    if (duration === null || duration === undefined) {
        return { valid: true, error: null }; // Duration is optional
    }

    if (typeof duration !== 'number' || duration <= 0) {
        return { valid: false, error: 'Duration must be a positive number' };
    }

    if (!Number.isInteger(duration)) {
        return { valid: false, error: 'Duration must be an integer' };
    }

    const validUnits = ['seconds', 'minutes', 'hours'];
    if (!validUnits.includes(unit?.toLowerCase())) {
        return { valid: false, error: 'Duration unit must be seconds, minutes, or hours' };
    }

    return { valid: true, error: null };
}

/**
 * Calculate expiration timestamp
 * @param {number} duration - Duration value
 * @param {string} unit - Duration unit
 * @param {Date} startTime - Start time (defaults to now)
 * @returns {Date} Expiration timestamp
 */
function calculateExpiration(duration, unit = 'minutes', startTime = new Date()) {
    const ms = toMilliseconds(duration, unit);
    return new Date(startTime.getTime() + ms);
}

/**
 * Check if duration has elapsed
 * @param {Date} startTime - When duration started
 * @param {number} duration - Duration value
 * @param {string} unit - Duration unit
 * @returns {boolean} True if duration has fully elapsed
 */
function hasElapsed(startTime, duration, unit = 'minutes') {
    const requiredMs = toMilliseconds(duration, unit);
    const elapsedMs = Date.now() - new Date(startTime).getTime();
    return elapsedMs >= requiredMs;
}

/**
 * Get time remaining
 * @param {Date} startTime - When duration started
 * @param {number} duration - Duration value
 * @param {string} unit - Duration unit
 * @returns {number} Milliseconds remaining (0 if elapsed)
 */
function getTimeRemaining(startTime, duration, unit = 'minutes') {
    const requiredMs = toMilliseconds(duration, unit);
    const elapsedMs = Date.now() - new Date(startTime).getTime();
    const remaining = requiredMs - elapsedMs;
    return Math.max(0, remaining);
}

module.exports = {
    toMilliseconds,
    fromMilliseconds,
    formatDuration,
    validateDuration,
    calculateExpiration,
    hasElapsed,
    getTimeRemaining,
};

