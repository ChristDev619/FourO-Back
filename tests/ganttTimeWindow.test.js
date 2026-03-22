/**
 * Unit Tests for ganttTimeWindow utility
 * Run with: node tests/ganttTimeWindow.test.js
 */

const { parseGanttTimeWindow, calculateGanttTimeWindow, GANTT_ZOOM_CONFIG } = require('../utils/ganttTimeWindow');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        testsPassed++;
    } else {
        console.error(`❌ FAIL: ${testName}`);
        testsFailed++;
    }
}

function assertEqual(actual, expected, testName) {
    if (actual === expected) {
        console.log(`✅ PASS: ${testName}`);
        testsPassed++;
    } else {
        console.error(`❌ FAIL: ${testName}`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Got: ${actual}`);
        testsFailed++;
    }
}

console.log('\n=== Testing ganttTimeWindow Utility ===\n');

// Test Suite 1: parseGanttTimeWindow - Default Behavior
console.log('📋 Test Suite 1: Default Behavior (Backward Compatibility)');
console.log('─'.repeat(60));

const test1 = parseGanttTimeWindow(undefined);
assertEqual(test1.hoursBack, 4, 'Should default to 4 hours when undefined');
assertEqual(test1.isValid, true, 'Should be valid when undefined');
assertEqual(test1.isDefault, true, 'Should mark as default when undefined');

const test2 = parseGanttTimeWindow(null);
assertEqual(test2.hoursBack, 4, 'Should default to 4 hours when null');
assertEqual(test2.isValid, true, 'Should be valid when null');

const test3 = parseGanttTimeWindow('');
assertEqual(test3.hoursBack, 4, 'Should default to 4 hours when empty string');
assertEqual(test3.isValid, true, 'Should be valid when empty string');

console.log('');

// Test Suite 2: parseGanttTimeWindow - Valid Inputs
console.log('📋 Test Suite 2: Valid Zoom Levels');
console.log('─'.repeat(60));

const test4 = parseGanttTimeWindow(0.5);
assertEqual(test4.hoursBack, 0.5, 'Should accept 0.5 hours (30 minutes)');
assertEqual(test4.isValid, true, 'Should be valid for 0.5 hours');

const test5 = parseGanttTimeWindow(1);
assertEqual(test5.hoursBack, 1, 'Should accept 1 hour');
assertEqual(test5.isValid, true, 'Should be valid for 1 hour');

const test6 = parseGanttTimeWindow(4);
assertEqual(test6.hoursBack, 4, 'Should accept 4 hours');
assertEqual(test6.isValid, true, 'Should be valid for 4 hours');
assertEqual(test6.isDefault, true, 'Should mark 4 hours as default');

const test7 = parseGanttTimeWindow(24);
assertEqual(test7.hoursBack, 24, 'Should accept 24 hours (maximum)');
assertEqual(test7.isValid, true, 'Should be valid for 24 hours');

const test8 = parseGanttTimeWindow('2');
assertEqual(test8.hoursBack, 2, 'Should parse string "2" to number 2');
assertEqual(test8.isValid, true, 'Should be valid for string number');

console.log('');

// Test Suite 3: parseGanttTimeWindow - Invalid Inputs (Fallback)
console.log('📋 Test Suite 3: Invalid Inputs (Fallback to Default)');
console.log('─'.repeat(60));

const test9 = parseGanttTimeWindow('abc');
assertEqual(test9.hoursBack, 4, 'Should fallback to 4 for invalid string');
assertEqual(test9.isValid, false, 'Should be invalid for non-numeric string');
assert(test9.fallbackUsed === true, 'Should indicate fallback was used');

const test10 = parseGanttTimeWindow(-5);
assertEqual(test10.hoursBack, 4, 'Should fallback to 4 for negative number');
assertEqual(test10.isValid, false, 'Should be invalid for negative number');

const test11 = parseGanttTimeWindow(0);
assertEqual(test11.hoursBack, 4, 'Should fallback to 4 for zero');
assertEqual(test11.isValid, false, 'Should be invalid for zero');

const test12 = parseGanttTimeWindow(0.1);
assertEqual(test12.hoursBack, 4, 'Should fallback to 4 for value below minimum');
assertEqual(test12.isValid, false, 'Should be invalid for value below 0.5');

const test13 = parseGanttTimeWindow(100);
assertEqual(test13.hoursBack, 4, 'Should fallback to 4 for value above maximum');
assertEqual(test13.isValid, false, 'Should be invalid for value above 24');

console.log('');

// Test Suite 4: calculateGanttTimeWindow
console.log('📋 Test Suite 4: Time Window Calculation');
console.log('─'.repeat(60));

const now = new Date('2026-02-21T12:00:00.000Z');

const calc1 = calculateGanttTimeWindow(now, 1);
assertEqual(calc1.hoursBack, 1, 'Should store hoursBack value');
assertEqual(calc1.endTime.toISOString(), now.toISOString(), 'End time should equal now');
assertEqual(calc1.startTime.toISOString(), '2026-02-21T11:00:00.000Z', 'Start time should be 1 hour before now');
assertEqual(calc1.durationMs, 3600000, 'Duration should be 3,600,000ms (1 hour)');

const calc2 = calculateGanttTimeWindow(now, 4);
assertEqual(calc2.startTime.toISOString(), '2026-02-21T08:00:00.000Z', 'Start time should be 4 hours before now');
assertEqual(calc2.durationMs, 14400000, 'Duration should be 14,400,000ms (4 hours)');

const calc3 = calculateGanttTimeWindow(now, 0.5);
assertEqual(calc3.startTime.toISOString(), '2026-02-21T11:30:00.000Z', 'Start time should be 30 minutes before now');
assertEqual(calc3.durationMs, 1800000, 'Duration should be 1,800,000ms (30 minutes)');

const calc4 = calculateGanttTimeWindow(now, 24);
assertEqual(calc4.startTime.toISOString(), '2026-02-20T12:00:00.000Z', 'Start time should be 24 hours before now');
assertEqual(calc4.durationMs, 86400000, 'Duration should be 86,400,000ms (24 hours)');

console.log('');

// Test Suite 5: Configuration Constants
console.log('📋 Test Suite 5: Configuration Constants');
console.log('─'.repeat(60));

assertEqual(GANTT_ZOOM_CONFIG.DEFAULT_HOURS, 4, 'Default should be 4 hours');
assertEqual(GANTT_ZOOM_CONFIG.MIN_HOURS, 0.5, 'Minimum should be 0.5 hours');
assertEqual(GANTT_ZOOM_CONFIG.MAX_HOURS, 24, 'Maximum should be 24 hours');
assert(Array.isArray(GANTT_ZOOM_CONFIG.RECOMMENDED_LEVELS), 'Recommended levels should be an array');
assert(GANTT_ZOOM_CONFIG.RECOMMENDED_LEVELS.includes(4), 'Recommended levels should include default (4)');

console.log('');

// Test Suite 6: Edge Cases
console.log('📋 Test Suite 6: Edge Cases & Boundary Conditions');
console.log('─'.repeat(60));

const edge1 = parseGanttTimeWindow(0.5); // Exact minimum
assertEqual(edge1.isValid, true, 'Should accept exact minimum (0.5)');
assertEqual(edge1.hoursBack, 0.5, 'Should return 0.5 for exact minimum');

const edge2 = parseGanttTimeWindow(24); // Exact maximum
assertEqual(edge2.isValid, true, 'Should accept exact maximum (24)');
assertEqual(edge2.hoursBack, 24, 'Should return 24 for exact maximum');

const edge3 = parseGanttTimeWindow(0.49); // Just below minimum
assertEqual(edge3.isValid, false, 'Should reject value just below minimum');
assertEqual(edge3.hoursBack, 4, 'Should fallback to default for below minimum');

const edge4 = parseGanttTimeWindow(24.01); // Just above maximum
assertEqual(edge4.isValid, false, 'Should reject value just above maximum');
assertEqual(edge4.hoursBack, 4, 'Should fallback to default for above maximum');

const edge5 = parseGanttTimeWindow('2.5'); // Decimal string
assertEqual(edge5.isValid, true, 'Should accept decimal string');
assertEqual(edge5.hoursBack, 2.5, 'Should parse decimal string correctly');

console.log('');

// Test Summary
console.log('='.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
console.log('='.repeat(60));

if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Utility is working correctly.\n');
    process.exit(0);
} else {
    console.log('\n⚠️  SOME TESTS FAILED! Please review the failures above.\n');
    process.exit(1);
}
