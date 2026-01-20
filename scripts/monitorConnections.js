/**
 * Simple connection pool monitoring script
 * Run this to see how many connections you're actually using
 */

const { sequelize } = require('../dbInit');

async function monitorConnections() {
    try {
        // Get current connection pool stats
        const pool = sequelize.connectionManager.pool;
        
        console.log('🔍 Connection Pool Status:');
        console.log(`   Max connections: ${pool.max}`);
        console.log(`   Min connections: ${pool.min}`);
        console.log(`   Used connections: ${pool.used}`);
        console.log(`   Pending requests: ${pool.pending}`);
        console.log(`   Available connections: ${pool.available}`);
        console.log(`   Pool utilization: ${((pool.used / pool.max) * 100).toFixed(1)}%`);
        
        // Warning thresholds
        const utilizationPercent = (pool.used / pool.max) * 100;
        
        if (utilizationPercent > 80) {
            console.log('⚠️  WARNING: High pool utilization! Consider increasing max connections.');
        } else if (utilizationPercent > 60) {
            console.log('🔶 NOTICE: Moderate pool utilization. Monitor during peak hours.');
        } else {
            console.log('✅ GOOD: Pool utilization is healthy.');
        }
        
        // Show active connections from database perspective
        const activeConnections = await sequelize.query(
            'SHOW PROCESSLIST',
            { type: sequelize.QueryTypes.SELECT }
        );
        
        console.log(`\n📊 Database perspective:`);
        console.log(`   Total active connections: ${activeConnections.length}`);
        console.log(`   Your app connections: ${activeConnections.filter(conn => 
            conn.User === process.env.DB_USER).length}`);
            
    } catch (error) {
        console.error('❌ Error monitoring connections:', error.message);
    }
}

// Run monitoring every 30 seconds if called directly
if (require.main === module) {
    console.log('🚀 Starting connection pool monitoring...');
    console.log('Press Ctrl+C to stop\n');
    
    // Initial check
    monitorConnections();
    
    // Check every 30 seconds
    setInterval(monitorConnections, 30000);
}

module.exports = { monitorConnections };
