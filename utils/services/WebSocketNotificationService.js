// D:\FourO\FourO-Back\utils\services\WebSocketNotificationService.js
const { redisPublisher } = require("../redisConfig");

class WebSocketNotificationService {
    /**
     * Publish a single tag value update to Redis
     * @param {number} tagId - The tag ID that was updated
     * @param {*} value - The new value of the tag
     * @param {string} currentTime - Timestamp of the update
     * @param {object} additionalData - Any additional data to send
     */
    async notifyTagValueUpdate(tagId, value, currentTime, additionalData = {}) {
        const payload = {
            tagId,
            value,
            currentTime,
            ...additionalData,
        };

        try {
            await redisPublisher.publish("tagUpdates", JSON.stringify(payload));
            console.log(`📡 Published tag update → Redis: tagId=${tagId}, value=${value}`);
        } catch (err) {
            console.error("❌ Failed to publish tag update:", err.message);
        }
    }

    /**
     * Publish multiple tag updates in batch to Redis
     * @param {Array} updates - Array of {tagId, value, currentTime, additionalData}
     */
    async notifyBatchTagValueUpdates(updates) {
        try {
            for (const { tagId, value, currentTime, additionalData } of updates) {
                await this.notifyTagValueUpdate(tagId, value, currentTime, additionalData);
            }
            console.log(`📡 Batch published ${updates.length} tag updates`);
        } catch (err) {
            console.error("❌ Failed to publish batch updates:", err.message);
        }
    }

    /**
     * Publish job completion event to Redis
     * @param {string} jobId - Job identifier
     * @param {object} result - Job result payload
     */
    async notifyJobCompletion(jobId, result) {
        const payload = {
            jobId,
            result,
            timestamp: new Date().toISOString(),
        };

        try {
            await redisPublisher.publish("jobCompletions", JSON.stringify(payload));
            console.log(`📡 Published job completion → Redis: jobId=${jobId}`);
        } catch (err) {
            console.error("❌ Failed to publish job completion:", err.message);
        }
    }
}

module.exports = WebSocketNotificationService;
