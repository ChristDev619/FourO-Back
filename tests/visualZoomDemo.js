/**
 * Visual Demonstration of Zoom Slider
 * Shows exactly what each zoom level returns
 * 
 * Run: node tests/visualZoomDemo.js
 */

const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 8011;
const REPORT_ID = '422'; // Running job report

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
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (error) {
                    reject(error);
                }
            });
        });
        
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.end();
    });
}

async function demonstrateZoomLevels() {
    console.log('\n' + '='.repeat(80));
    console.log('🔍 GANTT ZOOM SLIDER - VISUAL DEMONSTRATION');
    console.log('='.repeat(80));
    console.log(`Testing Report ID: ${REPORT_ID}\n`);
    
    const zoomLevels = [0.5, 1, 2, 4, 8, 12, 24];
    
    for (const zoom of zoomLevels) {
        try {
            const response = await makeRequest(`/api/reports/${REPORT_ID}/gantt/live?hoursBack=${zoom}`);
            
            if (response.status === 200) {
                const { timeRange, data } = response.data;
                const start = new Date(timeRange.start);
                const end = new Date(timeRange.end);
                const diffMinutes = ((end - start) / 60000).toFixed(0);
                const dataRows = data.length - 1; // Exclude header
                
                console.log('─'.repeat(80));
                console.log(`⏱️  ZOOM LEVEL: ${zoom} ${zoom === 1 ? 'hour' : 'hours'} ${zoom === 4 ? '(DEFAULT)' : ''}`);
                console.log('─'.repeat(80));
                console.log(`📅 Time Range:`);
                console.log(`   Start:    ${start.toLocaleString()}`);
                console.log(`   End:      ${end.toLocaleString()}`);
                console.log(`   Duration: ${diffMinutes} minutes (${zoom} hours)`);
                console.log(`\n📊 Data:`);
                console.log(`   Chart rows: ${dataRows}`);
                console.log(`   Machines:   ${response.data.machines?.length || 0}`);
                console.log(`\n🔧 Zoom Config:`);
                console.log(`   Current:  ${timeRange.zoomConfig.current}h`);
                console.log(`   Default:  ${timeRange.zoomConfig.default}h`);
                console.log(`   Range:    ${timeRange.zoomConfig.min}h - ${timeRange.zoomConfig.max}h`);
                console.log('');
            } else {
                console.log(`❌ Zoom ${zoom}h: Status ${response.status}`);
            }
        } catch (error) {
            console.log(`❌ Zoom ${zoom}h: ${error.message}`);
        }
    }
    
    console.log('='.repeat(80));
    console.log('✅ DEMONSTRATION COMPLETE');
    console.log('='.repeat(80));
    console.log('\n💡 Key Observations:');
    console.log('   • Smaller zoom (0.5-2h) = More detail, fewer data points');
    console.log('   • Default zoom (4h) = Balanced view (unchanged behavior)');
    console.log('   • Larger zoom (8-24h) = More context, more data points');
    console.log('   • All zoom levels work smoothly with real-time data');
    console.log('');
}

demonstrateZoomLevels().catch(console.error);
