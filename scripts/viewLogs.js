require('dotenv').config();
const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../logs');

function viewLogs(logType = 'error', lines = 50) {
  const logFile = path.join(logsDir, `${logType}.log`);
  
  if (!fs.existsSync(logFile)) {
    console.log(`❌ Log file not found: ${logFile}`);
    console.log('Available log files:');
    const files = fs.readdirSync(logsDir);
    files.forEach(file => {
      console.log(`  - ${file}`);
    });
    return;
  }

  const content = fs.readFileSync(logFile, 'utf8');
  const logLines = content.split('\n').filter(line => line.trim());
  
  console.log(`\n=== ${logType.toUpperCase()} LOGS (last ${lines} lines) ===\n`);
  
  const recentLines = logLines.slice(-lines);
  recentLines.forEach(line => {
    try {
      const logEntry = JSON.parse(line);
      const timestamp = logEntry.timestamp || 'N/A';
      const level = logEntry.level || 'INFO';
      const message = logEntry.message || 'No message';
      
      console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
      
      // Show additional context for queue jobs
      if (logEntry.type && logEntry.type.startsWith('queue_')) {
        if (logEntry.jobId) {
          console.log(`  Job ID: ${logEntry.jobId}`);
        }
        if (logEntry.error) {
          console.log(`  Error: ${logEntry.error}`);
        }
        if (logEntry.duration) {
          console.log(`  Duration: ${logEntry.duration}ms`);
        }
      }
      
      console.log('');
    } catch (e) {
      console.log(line);
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  const logType = args[0] || 'error';
  const lines = parseInt(args[1]) || 50;

  if (!fs.existsSync(logsDir)) {
    console.log('❌ Logs directory not found. No logs have been generated yet.');
    return;
  }

  switch (logType) {
    case 'error':
    case 'combined':
    case 'queue':
      viewLogs(logType, lines);
      break;
    case 'all':
      console.log('=== ALL LOG FILES ===\n');
      ['error', 'combined', 'queue'].forEach(type => {
        viewLogs(type, 10);
      });
      break;
    default:
      console.log('Usage: node scripts/viewLogs.js [logType] [lines]');
      console.log('Log types: error, combined, queue, all');
      console.log('Example: node scripts/viewLogs.js error 20');
      console.log('Example: node scripts/viewLogs.js queue 100');
  }
}

main(); 