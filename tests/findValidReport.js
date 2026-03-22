const {Report, sequelize} = require('../dbInit');

(async () => {
    try {
        const reports = await Report.findAll({ 
            attributes: ['id', 'name', 'config'], 
            limit: 10, 
            order: [['id', 'DESC']] 
        });
        
        console.log('\n📊 Recent Reports in Database:');
        console.log('─'.repeat(70));
        
        if (reports.length === 0) {
            console.log('No reports found in database.');
        } else {
            reports.forEach(r => {
                const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
                console.log(`ID: ${r.id} | Name: ${r.name}`);
                console.log(`   JobID: ${cfg.selectedJobId || 'N/A'} | LineID: ${cfg.selectedLineId || 'N/A'} | Running: ${cfg.isRunningJob || false}`);
            });
            
            console.log('\n💡 To test, use one of the Report IDs above:');
            console.log(`   $env:TEST_REPORT_ID="${reports[0].id}"; node tests/ganttApiIntegration.test.js`);
        }
        
        await sequelize.close();
    } catch(e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
