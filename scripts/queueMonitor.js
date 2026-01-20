require('dotenv').config();
const recalculationQueue = require('../utils/queues/recalculationQueue');

async function monitorQueue() {
    try {
        const stats = await recalculationQueue.getJobCounts();
        const now = new Date().toLocaleTimeString();
        
        console.log(`\n=== Queue Monitor (${now}) ===`);
        console.log(`Waiting: ${stats.waiting}`);
        console.log(`Active: ${stats.active}`);
        console.log(`Completed: ${stats.completed}`);
        console.log(`Failed: ${stats.failed}`);
        console.log(`Delayed: ${stats.delayed}`);
        // Show true total across all known statuses
        console.log(`Total: ${stats.waiting + stats.active + stats.completed + stats.failed + stats.delayed}`);
        
        // Check for potential issues
        if (stats.active > 2) {
            console.log(`⚠️  WARNING: ${stats.active} active jobs - potential Redis instability`);
        }
        
        if (stats.waiting > 10) {
            console.log(`⚠️  WARNING: ${stats.waiting} waiting jobs - queue overloaded`);
        }
        
        if (stats.failed > 0) {
            console.log(`❌  ERROR: ${stats.failed} failed jobs`);
        }
        
        console.log('========================\n');
        
    } catch (error) {
        console.error('❌ Queue monitoring error:', error.message);
    }
}

// Monitor every 30 seconds
setInterval(monitorQueue, 30000);

// Initial check
monitorQueue();

console.log('🔍 Queue monitor started - checking every 30 seconds...');
console.log('Press Ctrl+C to stop'); 