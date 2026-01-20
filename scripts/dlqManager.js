#!/usr/bin/env node
require('dotenv').config();
const { 
    getDLQJobs, 
    retryFromDLQ, 
    clearRetriedJobs 
} = require('../utils/queues/deadLetterQueue');

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
        switch (command) {
            case 'list':
                await listDLQJobs();
                break;
                
            case 'retry':
                const dlqJobId = args[1];
                if (!dlqJobId) {
                    console.error('Usage: node scripts/dlqManager.js retry <dlqJobId>');
                    process.exit(1);
                }
                await retryJob(dlqJobId);
                break;
                
            case 'clear':
                await clearRetried();
                break;
                
            default:
                showHelp();
                break;
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

async function listDLQJobs() {
    console.log('\n=== Dead Letter Queue Jobs ===\n');
    
    const jobs = await getDLQJobs('all', 50);
    
    if (jobs.length === 0) {
        console.log('✅ No jobs in Dead Letter Queue');
        return;
    }
    
    console.log(`Found ${jobs.length} jobs:\n`);
    
    jobs.forEach((job, index) => {
        console.log(`${index + 1}. DLQ Job ID: ${job.dlqJobId}`);
        console.log(`   Production Job ID: ${job.jobId}`);
        console.log(`   Status: ${job.status}`);
        console.log(`   Failed At: ${job.failedAt}`);
        console.log(`   Attempts: ${job.attempts}`);
        console.log(`   Error: ${job.error.message}`);
        if (job.retriedAt) {
            console.log(`   Retried At: ${job.retriedAt}`);
        }
        console.log('   ---');
    });
    
    console.log('\nTo retry a job: node scripts/dlqManager.js retry <dlqJobId>');
    console.log('To clear retried jobs: node scripts/dlqManager.js clear\n');
}

async function retryJob(dlqJobId) {
    console.log(`\n🔄 Retrying job ${dlqJobId}...\n`);
    
    await retryFromDLQ(dlqJobId);
    
    console.log('✅ Job moved back to main queue with high priority');
    console.log('Check recalculation worker logs to see processing\n');
}

async function clearRetried() {
    console.log('\n🗑️  Clearing retried jobs from DLQ...\n');
    
    const count = await clearRetriedJobs();
    
    console.log(`✅ Removed ${count} retried jobs\n`);
}

function showHelp() {
    console.log(`
Dead Letter Queue Manager
=========================

Commands:
  list              List all jobs in Dead Letter Queue
  retry <dlqJobId>  Retry a specific job from DLQ
  clear             Remove all retried jobs from DLQ

Examples:
  node scripts/dlqManager.js list
  node scripts/dlqManager.js retry 123
  node scripts/dlqManager.js clear

What is the Dead Letter Queue?
-------------------------------
When a job fails all retry attempts (5 times), it moves to the DLQ.
This prevents data loss and allows manual investigation and retry.
    `);
}

main();

