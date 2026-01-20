const JobNotificationService = require('./JobNotificationService');

// Global instance that will be set after WebSocket server is initialized
let globalJobNotificationService = null;

function setGlobalJobNotificationService(jobSubscriptions) {
    globalJobNotificationService = new JobNotificationService(jobSubscriptions);
}

function getGlobalJobNotificationService() {
    if (!globalJobNotificationService) {
        throw new Error('GlobalJobNotificationService not initialized. Call setGlobalJobNotificationService first.');
    }
    return globalJobNotificationService;
}

module.exports = {
    setGlobalJobNotificationService,
    getGlobalJobNotificationService
};