const { WebSocket } = require("ws");
const logger = require("../logger");

class TagSubscriptionService {
  constructor() {
    this.tagSubscriptions = new Map();
  }

  getSubscriptions(tagId) {
    return this.tagSubscriptions.get(tagId);
  }

  addSubscription(tagId, subscription) {
    if (!this.tagSubscriptions.has(tagId)) {
      this.tagSubscriptions.set(tagId, []);
    }
    this.tagSubscriptions.get(tagId).push(subscription);
  }

  removeSubscription(tagId, ws) {
    if (!this.tagSubscriptions.has(tagId)) return;
    const filtered = this.tagSubscriptions
      .get(tagId)
      .filter((sub) => sub.ws !== ws);
    if (filtered.length === 0) {
      this.tagSubscriptions.delete(tagId);
    } else {
      this.tagSubscriptions.set(tagId, filtered);
    }
  }

  notifySubscribers(tagId, value, currentTime) {
    const subscriptions = this.tagSubscriptions.get(tagId);
    if (subscriptions) {
      subscriptions.forEach((sub) => {
        if (sub.ws.readyState === WebSocket.OPEN) {
          sub.ws.send(
            JSON.stringify({
              cardId: sub.cardId,
              tagId,
              value,
              currentTime,
            })
          );
          logger.info('Sent tag update to client', { cardId: sub.cardId });
        } else {
          logger.warn('WebSocket is not open for cardId', { cardId: sub.cardId });
        }
      });
    }
  }
}

module.exports = new TagSubscriptionService();