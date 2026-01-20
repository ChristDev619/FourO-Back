require('dotenv').config();
const QueueManager = require('../utils/queueManager');
const { getDLQJobs } = require('../utils/queues/deadLetterQueue');

const queueManager = new QueueManager();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'stats':
        await showStats();
        break;
      case 'jobs':
        const jobType = args[1] || 'all';
        const limit = parseInt(args[2]) || 10;
        await showJobs(jobType, limit);
        break;
      case 'remove':
        const jobId = args[1];
        if (!jobId) {
          console.error('Please provide a job ID to remove');
          process.exit(1);
        }
        await queueManager.removeJob(jobId);
        break;
      case 'clean':
        const status = args[1];
        const cleanLimit = parseInt(args[2]) || 100;
        if (!status) {
          console.error('Please provide a status to clean (completed, failed, waiting, delayed)');
          process.exit(1);
        }
        await queueManager.removeJobsByStatus(status, cleanLimit);
        break;
      case 'clean-old':
        const hours = parseInt(args[1]) || 24;
        await queueManager.cleanOldJobs(hours);
        break;
      case 'pause':
        await queueManager.pauseQueue();
        break;
      case 'resume':
        await queueManager.resumeQueue();
        break;
      case 'empty':
        await queueManager.emptyQueue();
        break;
      case 'force-fail-active':
        await forceFailActive();
        break;
      case 'obliterate':
        await obliterateQueue();
        break;
      case 'dlq':
        await showDLQStatus();
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

async function showStats() {
  const stats = await queueManager.getQueueStats();
  console.log('\n=== Queue Statistics ===');
  console.log(`Waiting: ${stats.waiting}`);
  console.log(`Active: ${stats.active}`);
  console.log(`Completed: ${stats.completed}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Delayed: ${stats.delayed}`);
  console.log(`Paused: ${stats.paused}`);
  console.log(`Queue Status: ${stats.isPaused ? '⏸️  PAUSED' : '▶️  RUNNING'}`);
  console.log(`Total: ${stats.total}`);
  console.log('========================\n');
}

async function showJobs(jobType, limit) {
  const jobs = await queueManager.getJobDetails(jobType, limit);
  
  console.log(`\n=== ${jobType.toUpperCase()} Jobs (showing ${jobs.length}) ===`);
  
  if (jobs.length === 0) {
    console.log('No jobs found');
    return;
  }

  jobs.forEach(job => {
    console.log(`\nJob ID: ${job.id}`);
    console.log(`Status: ${job.status}`);
    console.log(`Data: ${JSON.stringify(job.data)}`);
    console.log(`Progress: ${job.progress}%`);
    console.log(`Created: ${new Date(job.timestamp).toLocaleString()}`);
    
    if (job.processedOn) {
      console.log(`Started: ${new Date(job.processedOn).toLocaleString()}`);
    }
    
    if (job.finishedOn) {
      console.log(`Finished: ${new Date(job.finishedOn).toLocaleString()}`);
    }
    
    if (job.failedReason) {
      console.log(`Failed Reason: ${job.failedReason}`);
    }
    
    if (job.attemptsMade > 0) {
      console.log(`Attempts: ${job.attemptsMade}`);
    }
    
    console.log('---');
  });
}

function showHelp() {
  console.log(`
Queue Inspector - Manage Bull Recalculation Queue

Usage: node scripts/queueInspector.js <command> [options]

Commands:
  stats                           Show queue statistics
  jobs [type] [limit]            Show jobs (type: all, waiting, active, completed, failed, delayed)
  remove <jobId>                 Remove a specific job
  clean <status> [limit]         Remove jobs by status (completed, failed, waiting, delayed)
  clean-old [hours]              Remove jobs older than specified hours (default: 24)
  pause                          Pause the queue
  resume                         Resume the queue
  empty                          Empty all jobs from the queue
  force-fail-active              Move all active jobs to failed (force)
  obliterate                     Completely delete the queue and all jobs (DANGEROUS)
  dlq                            Show Dead Letter Queue status (permanently failed jobs)

Examples:
  node scripts/queueInspector.js stats
  node scripts/queueInspector.js jobs waiting 5
  node scripts/queueInspector.js jobs failed 20
  node scripts/queueInspector.js remove 123
  node scripts/queueInspector.js clean completed 50
  node scripts/queueInspector.js clean-old 48
  node scripts/queueInspector.js pause
  node scripts/queueInspector.js resume
  node scripts/queueInspector.js empty
  node scripts/queueInspector.js force-fail-active
  node scripts/queueInspector.js obliterate
  node scripts/queueInspector.js dlq

Dead Letter Queue:
  Use 'node scripts/dlqManager.js' to manage permanently failed jobs
  - list: View all failed jobs
  - retry <dlqJobId>: Retry a specific failed job
  - clear: Remove successfully retried jobs
  `);
}

async function forceFailActive() {
  const q = require('../utils/queues/recalculationQueue');
  await q.pause();
  const active = await q.getActive(0, 1000);
  let moved = 0;
  for (const job of active) {
    try {
      await job.moveToFailed(new Error('force fail'), true);
      moved++;
    } catch (e) {
      console.error(`Could not force-fail job ${job && job.id}:`, e.message);
    }
  }
  console.log(`Force-failed ${moved} active jobs`);
}

async function obliterateQueue() {
  const q = require('../utils/queues/recalculationQueue');
  await q.pause();
  // Best-effort cleanup before obliterate
  try { await q.clean(0, 1000, 'failed'); } catch {}
  try { await q.clean(0, 1000, 'completed'); } catch {}
  try { await q.empty(); } catch {}
  await q.obliterate({ force: true });
  await q.resume();
  console.log('Queue obliterated');
}

async function showDLQStatus() {
  try {
    const jobs = await getDLQJobs('all', 100);
    
    const waiting = jobs.filter(j => j.status === 'waiting');
    const retried = jobs.filter(j => j.status === 'retried');
    
    console.log('\n=== Dead Letter Queue Status ===');
    console.log(`Failed Jobs (need review): ${waiting.length}`);
    console.log(`Retried Jobs: ${retried.length}`);
    console.log(`Total: ${jobs.length}`);
    console.log('================================\n');
    
    if (waiting.length > 0) {
      console.log('⚠️  Failed Jobs Details:\n');
      waiting.slice(0, 10).forEach((job, index) => {
        console.log(`${index + 1}. DLQ Job ID: ${job.dlqJobId}`);
        console.log(`   Production Job ID: ${job.jobId}`);
        console.log(`   Failed At: ${job.failedAt}`);
        console.log(`   Attempts: ${job.attempts}`);
        console.log(`   Error: ${job.error.message}`);
        console.log('   ---');
      });
      
      if (waiting.length > 10) {
        console.log(`   ... and ${waiting.length - 10} more\n`);
      }
      
      console.log('💡 To manage DLQ: node scripts/dlqManager.js list');
      console.log('💡 To retry a job: node scripts/dlqManager.js retry <dlqJobId>\n');
    } else {
      console.log('✅ No failed jobs in Dead Letter Queue\n');
    }
  } catch (error) {
    console.error('Error checking DLQ:', error.message);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  process.exit(0);
});

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 