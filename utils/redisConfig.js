const redis = require('redis');

// Detect environment
const isProduction = process.env.NODE_ENV === 'production';
const isAzureRedis = process.env.REDIS_HOST && (process.env.REDIS_HOST.includes('azure') || process.env.REDIS_HOST.includes('redis.cache.windows.net'));
const isLocalDocker = !isAzureRedis;

console.log(`Redis Config - Environment: ${isProduction ? 'production' : 'development'}, Azure: ${isAzureRedis}`);

// Base configuration
const baseConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: 6379, // Force non-SSL port for Azure Redis compatibility
    password: process.env.REDIS_PASSWORD || undefined
};

// Timeouts based on environment
const timeouts = isAzureRedis ? {
    connectTimeout: 30000,  // 30s for Azure
    commandTimeout: 15000   // 15s for Azure
} : {
    connectTimeout: 10000,  // 10s for local (increased from 5s)
    commandTimeout: 8000    // 8s for local (increased from 3s)
};

// Shared Redis configuration (for direct redis client)
const redisConfig = {
    socket: {
        host: baseConfig.host,
        port: baseConfig.port,
        connectTimeout: timeouts.connectTimeout,
        commandTimeout: timeouts.commandTimeout,
        // Keep TCP connection alive to avoid Azure idle disconnects
        keepAlive: 60000,
        reconnectStrategy: (retries) => {
            // Allow more retries in Azure environments
            if (retries > 50) {
                console.error(`Redis reconnection failed after ${retries} attempts`);
                return false;
            }
            // Exponential backoff with cap and jitter
            const base = Math.min(500 * Math.pow(2, Math.max(0, retries - 1)), 5000);
            const jitter = Math.floor(Math.random() * 250);
            const delay = base + jitter;
            console.log(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
            return delay;
        }
    },
    password: baseConfig.password
};

// Add TLS only for Azure Redis - DISABLED (Azure allows non-SSL on 6379)
// if (isAzureRedis) {
//     redisConfig.socket.tls = {
//         servername: baseConfig.host,
//         rejectUnauthorized: false
//     };
// }

// Bull Queue Redis configuration (uses ioredis format)
const bullRedisConfig = {
    host: baseConfig.host,
    port: baseConfig.port,
    password: baseConfig.password,

    // Connection settings - optimized for Azure
    connectTimeout: timeouts.connectTimeout,
    commandTimeout: timeouts.commandTimeout,
    lazyConnect: false, // Connect immediately to avoid issues
    keepAlive: 30000,
    family: 4,

    // Retry settings - more conservative for Azure
    maxRetriesPerRequest: 2, // Reduced from 3 to prevent infinite loops
    retryDelayOnFailover: isAzureRedis ? 1000 : 1000, // Reduced for faster recovery
    retryDelayOnClusterDown: 500,

    // Performance settings
    enableReadyCheck: false,
    enableOfflineQueue: true, // Allow queuing for better reliability
    enableAutoPipelining: false,
    showFriendlyErrorStack: true,
    
    // Additional resilience settings
    autoResendUnfulfilledCommands: true,
    retryStrategy: (times) => {
        if (times > 15) { // Reduced from 20 to prevent excessive retries
            console.error(`Redis reconnection failed after 15 attempts`);
            return false;
        }
        const delay = Math.min(times * 500, 5000); // Faster retry with lower cap
        console.log(`Redis reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
    },

    // Reconnect on specific errors
    reconnectOnError: (err) => {
        const msg = err && err.message ? err.message : '';
        if (msg.includes('READONLY') || msg.includes('ETIMEDOUT') || msg.includes('EPIPE') || msg.includes('ECONNRESET')) {
            console.log(`Redis reconnecting due to error: ${msg}`);
            return true;
        }
        return false;
    },

    // Azure Redis specific settings
    ...(isAzureRedis && {
        // Azure Redis connection pool settings
        maxRetriesPerRequest: 3, // Reduced from 5
        retryDelayOnFailover: 1000, // Reduced from 2000
        enableOfflineQueue: true,
        connectTimeout: 30000, // Reduced from 45000
        commandTimeout: 15000, // Reduced from 20000
        
        // Better connection management for Azure
        keepAlive: 30000, // Reduced from 60000
        family: 4,
        
        // Azure Redis specific retry strategy - more aggressive
        retryStrategy: (times) => {
            if (times > 8) { // Reduced from 10
                console.error(`Azure Redis reconnection failed after 8 attempts`);
                return false;
            }
            const delay = Math.min(times * 1000, 5000); // Faster retry
            console.log(`Azure Redis reconnecting in ${delay}ms (attempt ${times})`);
            return delay;
        },

        // More aggressive reconnection for Azure
        reconnectOnError: (err) => {
            const msg = err && err.message ? err.message : '';
            if (msg.includes('READONLY') || msg.includes('ETIMEDOUT') || msg.includes('EPIPE') || msg.includes('ECONNRESET') || msg.includes('ENOTFOUND')) {
                console.log(`Azure Redis reconnecting due to error: ${msg}`);
                return true;
            }
            return false;
        }
    })
};

// Add TLS for Azure Redis in Bull format - DISABLED (Azure allows non-SSL on 6379)
// if (isAzureRedis) {
//     bullRedisConfig.tls = {
//         servername: baseConfig.host,
//         rejectUnauthorized: false,
//         secureProtocol: 'TLSv1_2_method'
//     };
// }

// Shared Redis client instances
let sharedSubscriber = null;
let sharedPublisher = null;

async function getSharedSubscriber() {
    if (!sharedSubscriber) {
        sharedSubscriber = redis.createClient(redisConfig);
        
        sharedSubscriber.on('error', (err) => {
            console.error('Redis subscriber error:', err.message);
            // Do not null the client on transient errors; node-redis will auto-reconnect
        });
        
        sharedSubscriber.on('ready', () => {
            console.log('✓ Redis subscriber ready');
        });
        
        sharedSubscriber.on('connect', () => {
            console.log('✓ Redis subscriber connected');
        });
        
        try {
            await sharedSubscriber.connect();
        } catch (error) {
            console.error('Failed to connect Redis subscriber:', error.message);
            sharedSubscriber = null;
            throw error;
        }
    }
    return sharedSubscriber;
}

async function getSharedPublisher() {
    if (!sharedPublisher) {
        sharedPublisher = redis.createClient(redisConfig);
        
        sharedPublisher.on('error', (err) => {
            console.error('Redis publisher error:', err.message);
            // Do not null the client on errors; allow auto-reconnect
        });
        
        sharedPublisher.on('ready', () => {
            console.log('✓ Redis publisher ready');
        });
        
        sharedPublisher.on('connect', () => {
            console.log('✓ Redis publisher connected');
        });
        
        try {
            await sharedPublisher.connect();
        } catch (error) {
            console.error('Failed to connect Redis publisher:', error.message);
            sharedPublisher = null;
            throw error;
        }
    }
    return sharedPublisher;
}

// Force recreation of the shared publisher on hard failures
async function resetSharedPublisher() {
    if (sharedPublisher) {
        try { await sharedPublisher.quit(); } catch (e) { /* ignore */ }
        sharedPublisher = null;
        console.log('✓ Redis shared publisher reset');
    }
}

// Graceful shutdown
async function closeRedisConnections() {
    const promises = [];
    
    if (sharedSubscriber) {
        promises.push(sharedSubscriber.quit().catch(err => 
            console.error('Error closing subscriber:', err)
        ));
        sharedSubscriber = null;
    }
    
    if (sharedPublisher) {
        promises.push(sharedPublisher.quit().catch(err => 
            console.error('Error closing publisher:', err)
        ));
        sharedPublisher = null;
    }
    
    await Promise.all(promises);
    console.log('✓ Redis connections closed');
}

// Redis health check function
async function checkRedisHealth() {
    try {
        const publisher = await getSharedPublisher();
        const subscriber = await getSharedSubscriber();
        
        // Test basic operations
        await publisher.ping();
        console.log('✓ Redis health check passed');
        return true;
    } catch (error) {
        console.error('❌ Redis health check failed:', error.message);
        return false;
    }
}

// Log the configuration being used
console.log('Redis Configuration:');
console.log(`  Host: ${baseConfig.host}`);
console.log(`  Port: ${baseConfig.port}`);
console.log(`  Password: ${baseConfig.password ? 'SET' : 'NOT SET'}`);
console.log(`  TLS: ${isAzureRedis ? 'ENABLED' : 'DISABLED'}`);
console.log(`  Connect Timeout: ${timeouts.connectTimeout}ms`);
console.log(`  Command Timeout: ${timeouts.commandTimeout}ms`);

module.exports = {
    redisConfig,
    bullRedisConfig,
    getSharedSubscriber,
    getSharedPublisher,
    resetSharedPublisher,
    closeRedisConnections,
    checkRedisHealth,
    isAzureRedis,
    isLocalDocker
};
