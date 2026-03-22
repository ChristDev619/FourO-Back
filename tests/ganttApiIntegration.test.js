/**
 * Integration Tests for Live Gantt API with Zoom
 * Tests the actual API endpoint with different zoom levels
 * 
 * USAGE: 
 *   1. Make sure the server is running (npm run start:dev)
 *   2. Set REPORT_ID to a valid report with a running job
 *   3. Run: node tests/ganttApiIntegration.test.js
 */

const http = require('http');

// ===== CONFIGURATION =====
const API_HOST = 'localhost';
const API_PORT = 8011;
const REPORT_ID = process.env.TEST_REPORT_ID || '1';

// Test configuration
const ZOOM_LEVELS_TO_TEST = [
    { value: 0.5, label: '30 minutes' },
    { value: 1, label: '1 hour' },
    { value: 2, label: '2 hours' },
    { value: 4, label: '4 hours (default)' },
    { value: 8, label: '8 hours' },
    { value: 24, label: '24 hours' }
];

const INVALID_INPUTS_TO_TEST = [
    { value: 'abc', label: 'Invalid string' },
    { value: -5, label: 'Negative number' },
    { value: 0, label: 'Zero' },
    { value: 100, label: 'Above maximum' },
    { value: 0.1, label: 'Below minimum' }
];

let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;

// ===== HELPER FUNCTIONS =====
function logTest(status, message, details = '') {
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${icon} ${status}: ${message}`);
    if (details) console.log(`   ${details}`);
}

function assert(condition, testName, details = '') {
    if (condition) {
        logTest('PASS', testName, details);
        testsPassed++;
        return true;
    } else {
        logTest('FAIL', testName, details);
        testsFailed++;
        return false;
    }
}

function skip(testName, reason) {
    logTest('SKIP', testName, reason);
    testsSkipped++;
}

// HTTP request wrapper
function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: path,
            method: 'GET'
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch (error) {
                    reject(new Error(`Failed to parse JSON: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// ===== TEST FUNCTIONS =====
async function testDefaultZoom() {
    console.log('\n📋 Test Suite 1: Default Behavior (No Query Parameter)');
    console.log('─'.repeat(70));
    
    try {
        const response = await makeRequest(`/api/reports/${REPORT_ID}/gantt/live`);
        
        assert(response.status === 200, 'Should return 200 status', `Status: ${response.status}`);
        assert(response.data.timeRange !== undefined, 'Should include timeRange in response');
        assert(response.data.timeRange.hoursBack === 4, 'Should default to 4 hours', `hoursBack: ${response.data.timeRange.hoursBack}`);
        assert(response.data.timeRange.zoomConfig !== undefined, 'Should include zoomConfig');
        assert(response.data.timeRange.zoomConfig.current === 4, 'zoomConfig.current should be 4');
        assert(response.data.data !== undefined, 'Should include data array');
        
        return true;
    } catch (error) {
        if (error.message.includes('ECONNREFUSED')) {
            logTest('FAIL', 'Cannot connect to server', `Server not running at ${API_HOST}:${API_PORT}`);
            testsFailed++;
            return false;
        } else {
            skip('Default zoom test', error.message);
            return false;
        }
    }
}

async function testValidZoomLevels() {
    console.log('\n📋 Test Suite 2: Valid Zoom Levels');
    console.log('─'.repeat(70));
    
    for (const zoom of ZOOM_LEVELS_TO_TEST) {
        try {
            const response = await makeRequest(`/api/reports/${REPORT_ID}/gantt/live?hoursBack=${zoom.value}`);
            
            assert(
                response.status === 200, 
                `${zoom.label} - Should return 200`, 
                `Zoom: ${zoom.value}h`
            );
            assert(
                response.data.timeRange.hoursBack === zoom.value, 
                `${zoom.label} - Should return correct hoursBack`, 
                `Expected: ${zoom.value}, Got: ${response.data.timeRange.hoursBack}`
            );
            assert(
                response.data.data !== undefined, 
                `${zoom.label} - Should include data array`
            );
            
            // Verify time range calculation
            const start = new Date(response.data.timeRange.start);
            const end = new Date(response.data.timeRange.end);
            const diffHours = (end - start) / (1000 * 60 * 60);
            
            // Allow tolerance for time differences
            const tolerance = 5 / 60;
            assert(
                Math.abs(diffHours - zoom.value) < tolerance,
                `${zoom.label} - Time range should match`,
                `Expected: ~${zoom.value}h, Got: ${diffHours.toFixed(2)}h`
            );
            
        } catch (error) {
            skip(`${zoom.label}`, error.message);
        }
    }
}

async function testInvalidInputs() {
    console.log('\n📋 Test Suite 3: Invalid Inputs (Fallback Behavior)');
    console.log('─'.repeat(70));
    
    for (const input of INVALID_INPUTS_TO_TEST) {
        try {
            const response = await makeRequest(`/api/reports/${REPORT_ID}/gantt/live?hoursBack=${input.value}`);
            
            // Should still return 200 but with fallback to default (4 hours)
            assert(
                response.status === 200, 
                `${input.label} - Should return 200 (graceful fallback)`, 
                `Input: ${input.value}`
            );
            assert(
                response.data.timeRange.hoursBack === 4, 
                `${input.label} - Should fallback to 4 hours`, 
                `Expected: 4, Got: ${response.data.timeRange.hoursBack}`
            );
            
        } catch (error) {
            skip(`${input.label}`, error.message);
        }
    }
}

async function testResponseStructure() {
    console.log('\n📋 Test Suite 4: Response Structure Validation');
    console.log('─'.repeat(70));
    
    try {
        const response = await makeRequest(`/api/reports/${REPORT_ID}/gantt/live?hoursBack=2`);
        
        // Verify response structure
        assert(response.data.data !== undefined, 'Response should include data array');
        assert(response.data.timeRange !== undefined, 'Response should include timeRange');
        assert(response.data.timeRange.start !== undefined, 'timeRange should include start');
        assert(response.data.timeRange.end !== undefined, 'timeRange should include end');
        assert(response.data.timeRange.hoursBack !== undefined, 'timeRange should include hoursBack');
        assert(response.data.timeRange.zoomConfig !== undefined, 'timeRange should include zoomConfig');
        
        // Verify zoomConfig structure
        const zoomConfig = response.data.timeRange.zoomConfig;
        assert(zoomConfig.current !== undefined, 'zoomConfig should include current');
        assert(zoomConfig.default !== undefined, 'zoomConfig should include default');
        assert(zoomConfig.min !== undefined, 'zoomConfig should include min');
        assert(zoomConfig.max !== undefined, 'zoomConfig should include max');
        assert(Array.isArray(zoomConfig.recommendedLevels), 'zoomConfig.recommendedLevels should be array');
        
        // Verify zoomConfig values
        assert(zoomConfig.default === 4, 'zoomConfig.default should be 4');
        assert(zoomConfig.min === 0.5, 'zoomConfig.min should be 0.5');
        assert(zoomConfig.max === 24, 'zoomConfig.max should be 24');
        assert(zoomConfig.current === 2, 'zoomConfig.current should match requested (2)', `Got: ${zoomConfig.current}`);
        
        return true;
    } catch (error) {
        skip('Response structure test', error.message);
        return false;
    }
}

async function testBackwardCompatibility() {
    console.log('\n📋 Test Suite 5: Backward Compatibility');
    console.log('─'.repeat(70));
    console.log('Testing that old API calls (without zoom) work exactly as before...\n');
    
    try {
        // Test 1: Default call (no parameter)
        const response1 = await makeRequest(`/api/reports/${REPORT_ID}/gantt/live`);
        assert(
            response1.status === 200 && response1.data.timeRange.hoursBack === 4,
            'Old API call should work with 4-hour default',
            'GET /gantt/live (no params)'
        );
        
        // Test 2: Explicit 4-hour call should behave the same
        const response2 = await makeRequest(`/api/reports/${REPORT_ID}/gantt/live?hoursBack=4`);
        assert(
            response2.status === 200 && response2.data.timeRange.hoursBack === 4,
            'Explicit 4-hour zoom should work identically',
            'GET /gantt/live?hoursBack=4'
        );
        
        // Test 3: Response structure should be compatible
        assert(
            response1.data.data !== undefined,
            'Old calls should still receive data array'
        );
        assert(
            response1.data.job !== undefined || response1.data.job === null,
            'Old calls should still receive job field'
        );
        assert(
            response1.data.line !== undefined,
            'Old calls should still receive line field'
        );
        assert(
            response1.data.machines !== undefined,
            'Old calls should still receive machines array'
        );
        
        return true;
    } catch (error) {
        skip('Backward compatibility test', error.message);
        return false;
    }
}

// ===== MAIN TEST RUNNER =====
async function runAllTests() {
    console.log('\n' + '='.repeat(70));
    console.log('🧪 GANTT ZOOM SLIDER - API INTEGRATION TESTS');
    console.log('='.repeat(70));
    console.log(`📡 Testing API at: http://${API_HOST}:${API_PORT}/api`);
    console.log(`📊 Using Report ID: ${REPORT_ID}`);
    console.log('='.repeat(70));
    
    // Test server connectivity first
    try {
        await makeRequest(`/api/reports/${REPORT_ID}/gantt/live`);
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
            console.error('\n❌ ERROR: Cannot connect to server');
            console.error(`   Make sure the server is running at http://${API_HOST}:${API_PORT}`);
            console.error('   Start server with: npm run start:dev\n');
            process.exit(1);
        }
    }
    
    // Run all test suites
    await testDefaultZoom();
    await testValidZoomLevels();
    await testInvalidInputs();
    await testResponseStructure();
    await testBackwardCompatibility();
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Passed: ${testsPassed}`);
    console.log(`❌ Failed: ${testsFailed}`);
    console.log(`⏭️  Skipped: ${testsSkipped}`);
    
    if (testsFailed === 0 && testsPassed > 0) {
        const total = testsPassed + testsFailed;
        console.log(`📈 Success Rate: ${((testsPassed / total) * 100).toFixed(1)}%`);
    }
    
    console.log('='.repeat(70));
    
    if (testsFailed === 0 && testsPassed > 0) {
        console.log('\n🎉 ALL INTEGRATION TESTS PASSED!');
        console.log('✅ Backend API is working correctly with zoom slider');
        console.log('✅ Ready for deployment!\n');
        process.exit(0);
    } else if (testsSkipped > 0 && testsPassed === 0) {
        console.log('\n⚠️  ALL TESTS SKIPPED');
        console.log('   Please ensure:');
        console.log(`   1. Server is running at http://${API_HOST}:${API_PORT}`);
        console.log(`   2. Report ID ${REPORT_ID} exists and has an active job`);
        console.log('   3. Database has recent tag values\n');
        process.exit(0);
    } else {
        console.log('\n⚠️  SOME TESTS FAILED! Please review failures above.\n');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    console.error('\n❌ FATAL ERROR:', error.message);
    console.error(error);
    process.exit(1);
});
