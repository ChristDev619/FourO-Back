require('dotenv').config();
const https = require('https');
const http = require('http');
const logger = require('../utils/logger');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://fouro-backend-instance.uaecentral.azurecontainer.io';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://fouro-frontend1-a8evhqa8cngpg5a5.uaenorth-01.azurewebsites.net';

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  // For health check, keep console output for readability but also log to winston
  console.log(`${colors[color]}${message}${colors.reset}`);
  logger.info('Health check status', { message, status: color });
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    
    const requestOptions = {
      timeout: 10000,
      ...options
    };

    const req = client.request(url, requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function checkBackend() {
  log('\n🔍 Checking Backend Health...', 'blue');
  
  try {
    // Check main API endpoint
    const response = await makeRequest(`${BACKEND_URL}/api/health`);
    
    if (response.statusCode === 200) {
      log('✅ Backend API is responding', 'green');
      return true;
    } else {
      log(`⚠️  Backend API returned status: ${response.statusCode}`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`❌ Backend API check failed: ${error.message}`, 'red');
    return false;
  }
}

async function checkFrontend() {
  log('\n🎨 Checking Frontend Health...', 'blue');
  
  try {
    const response = await makeRequest(FRONTEND_URL);
    
    if (response.statusCode === 200) {
      log('✅ Frontend is responding', 'green');
      return true;
    } else {
      log(`⚠️  Frontend returned status: ${response.statusCode}`, 'yellow');
      return false;
    }
  } catch (error) {
    log(`❌ Frontend check failed: ${error.message}`, 'red');
    return false;
  }
}

async function checkDatabase() {
  log('\n🗄️  Checking Database Connection...', 'blue');
  
  try {
    const { Sequelize } = require('sequelize');
    
    const sequelize = new Sequelize({
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: "mysql",
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },
      timezone: "+00:00",
      logging: false
    });

    await sequelize.authenticate();
    log('✅ Database connection successful', 'green');
    await sequelize.close();
    return true;
  } catch (error) {
    log(`❌ Database connection failed: ${error.message}`, 'red');
    return false;
  }
}

async function checkWebSocket() {
  log('\n🔌 Checking WebSocket Connection...', 'blue');
  
  try {
    const WebSocket = require('ws');
    const ws = new WebSocket(`wss://${BACKEND_URL.replace('https://', '')}`);
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log('❌ WebSocket connection timeout', 'red');
        ws.close();
        resolve(false);
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        log('✅ WebSocket connection successful', 'green');
        ws.close();
        resolve(true);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        log(`❌ WebSocket connection failed: ${error.message}`, 'red');
        resolve(false);
      });
    });
  } catch (error) {
    log(`❌ WebSocket check failed: ${error.message}`, 'red');
    return false;
  }
}

async function runHealthCheck() {
  log('🚀 Starting FourO Health Check...', 'blue');
  
  const results = {
    backend: await checkBackend(),
    frontend: await checkFrontend(),
    database: await checkDatabase(),
    websocket: await checkWebSocket()
  };

  log('\n📊 Health Check Summary:', 'blue');
  log('========================', 'blue');
  
  Object.entries(results).forEach(([service, status]) => {
    const icon = status ? '✅' : '❌';
    const color = status ? 'green' : 'red';
    log(`${icon} ${service.toUpperCase()}: ${status ? 'HEALTHY' : 'UNHEALTHY'}`, color);
  });

  const allHealthy = Object.values(results).every(status => status);
  
  if (allHealthy) {
    log('\n🎉 All services are healthy!', 'green');
  } else {
    log('\n⚠️  Some services are unhealthy. Please check the logs above.', 'yellow');
  }

  return results;
}

// Run health check if this script is executed directly
if (require.main === module) {
  runHealthCheck().catch((error) => {
    logger.error('Health check failed', { error: error.message, stack: error.stack });
    console.error(error);
  });
}

module.exports = { runHealthCheck };
