const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

// Log file path (in the project root)
const LOG_FILE = path.join(__dirname, '..', 'live.log');

// Max log file size (5MB) - rotate when exceeded
const MAX_LOG_SIZE = 5 * 1024 * 1024;

/**
 * Rotate log file if it exceeds max size
 */
function rotateLogIfNeeded() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size > MAX_LOG_SIZE) {
                const backupFile = LOG_FILE.replace('.log', `.${Date.now()}.log`);
                fs.renameSync(LOG_FILE, backupFile);
                console.log(`[LIVE LOGGER] Rotated log file to: ${backupFile}`);
            }
        }
    } catch (error) {
        console.error('[LIVE LOGGER] Error rotating log:', error.message);
    }
}

/**
 * Write to live.log with timestamp
 * @param {string} message - Log message
 * @param {object} data - Optional data to log (will be JSON stringified)
 */
function logLive(message, data = null) {
    try {
        rotateLogIfNeeded();
        
        const timestamp = dayjs().utc().format('YYYY-MM-DD HH:mm:ss.SSS');
        let logEntry = `[${timestamp} UTC] ${message}`;
        
        if (data !== null) {
            if (typeof data === 'object') {
                logEntry += '\n' + JSON.stringify(data, null, 2);
            } else {
                logEntry += ' ' + String(data);
            }
        }
        
        logEntry += '\n';
        
        fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
        
        // Also log to console for real-time monitoring
        console.log(`[LIVE LOG] ${message}`, data !== null ? data : '');
    } catch (error) {
        console.error('[LIVE LOGGER] Error writing to log:', error.message);
    }
}

/**
 * Log a separator line for better readability
 */
function logSeparator() {
    try {
        fs.appendFileSync(LOG_FILE, '\n' + '='.repeat(80) + '\n\n', 'utf8');
    } catch (error) {
        console.error('[LIVE LOGGER] Error writing separator:', error.message);
    }
}

/**
 * Clear the live.log file (useful for fresh debugging sessions)
 */
function clearLiveLog() {
    try {
        fs.writeFileSync(LOG_FILE, '', 'utf8');
        console.log('[LIVE LOGGER] Cleared live.log');
    } catch (error) {
        console.error('[LIVE LOGGER] Error clearing log:', error.message);
    }
}

module.exports = {
    logLive,
    logSeparator,
    clearLiveLog,
    LOG_FILE
};
