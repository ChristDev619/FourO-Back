require('dotenv').config();
const logger = require('../utils/logger');

console.log('🧪 Testing the new logging system...\n');

// Test different log levels
logger.info('This is an info message');
logger.warn('This is a warning message');
logger.error('This is an error message');

// Test queue-specific logging
logger.queue.jobStarted(123, { jobId: 123, type: 'recalculation' });
logger.queue.jobCompleted(123, 5000); // 5 seconds
logger.queue.jobFailed(456, new Error('Database connection failed'), { jobId: 456, type: 'recalculation' });
logger.queue.jobStalled(789, { jobId: 789, type: 'recalculation' });

console.log('\n✅ Logging test completed!');
console.log('📁 Check the logs directory for generated log files:');
console.log('   - logs/error.log (only errors)');
console.log('   - logs/combined.log (all levels)');
console.log('   - logs/queue.log (queue-specific logs)');
console.log('\n🔍 View logs with: npm run logs:view'); 