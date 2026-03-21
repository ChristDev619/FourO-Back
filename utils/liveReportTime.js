const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

/** Fixed wall-time zone for naive DATETIME values from the line API (Lebanon). */
const LIVE_REPORT_WALL_TIMEZONE = "Asia/Beirut";

/**
 * Naive DATETIME from the line API is wall time in Asia/Beirut; Sequelize reads as UTC.
 * Use this when comparing stored job/program timestamps to real "now" in live reports.
 *
 * @param {Date|string|null|undefined} dbDate
 * @returns {import("dayjs").Dayjs|null}
 */
function liveInstantFromDbDate(dbDate) {
    if (!dbDate) return null;
    const wall = dayjs.utc(dbDate).format("YYYY-MM-DD HH:mm:ss");
    const z = dayjs.tz(wall, "YYYY-MM-DD HH:mm:ss", LIVE_REPORT_WALL_TIMEZONE);
    return z.isValid() ? z : null;
}

module.exports = {
    LIVE_REPORT_WALL_TIMEZONE,
    liveInstantFromDbDate,
};
