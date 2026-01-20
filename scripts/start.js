const { spawn } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');

const isProduction = process.env.NODE_ENV === 'production';

logger.info('Starting FourO Backend', { mode: isProduction ? 'production' : 'development' });

if (isProduction) {
  // In production, use PM2 to manage both processes
  logger.info('Starting with PM2', { manager: 'pm2' });
  const pm2 = spawn('pm2-runtime', ['start', 'ecosystem.config.js', '--env', 'production'], {
    stdio: 'inherit',
    cwd: __dirname + '/..'
  });

  pm2.on('error', (err) => {
    logger.error('Failed to start PM2', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  pm2.on('exit', (code) => {
    logger.info('PM2 process exited', { code });
    process.exit(code);
  });
} else {
  // In development, start only API process (worker can be started separately if needed)
  logger.info('Starting in development mode');
  logger.info('Starting API process');
  const api = spawn('node', ['index.js'], {
    stdio: 'inherit',
    cwd: __dirname + '/..'
  });

  // Worker process disabled in development to avoid Redis connection issues
  // To enable worker: npm run start:worker
  logger.info('Worker process skipped in development mode. Use "npm run start:worker" if needed.');

  api.on('error', (err) => {
    logger.error('Failed to start API', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  api.on('exit', (code) => {
    logger.info('API process exited', { code });
    process.exit(code);
  });
} 