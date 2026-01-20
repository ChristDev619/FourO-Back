// D:\FourO\FourO-Back\utils\redisConfig.js
const WebSocket = require("ws");
const uuid = require("uuid");
const { getSharedSubscriber } = require("./utils/redisConfig");
const { checkAndTriggerNotifications } = require("./handlers/notificationEventHandler");

// ----------------------------
// Redis Subscriber (shared client)
// ----------------------------
let sharedRedisSubscriber = null;

// ----------------------------
// Subscription Maps
// ----------------------------
const tagSubscriptions = new Map(); // tagId -> Map(subId -> {ws, userId, cardId, type})
const jobSubscriptions = new Map(); // jobId -> Map(subId -> {ws, userId, jobId})

// ----------------------------
// WebSocket Server
// ----------------------------
let wss = null; // Global reference to WebSocket server

function setupWebSocket(server) {
  wss = new WebSocket.Server({ server });

  wss.on("connection", (ws, req) => {
    console.log("🔌 New WebSocket connection established");
    try {
      const addr = (req && req.socket && req.socket.remoteAddress) ? req.socket.remoteAddress : "unknown";
      const origin = (req && req.headers && req.headers.origin) ? req.headers.origin : "unknown";
      const ua = (req && req.headers && req.headers["user-agent"]) ? req.headers["user-agent"] : "unknown";
      console.log("🔎 WebSocket client:", { remoteAddress: addr, origin, userAgent: ua });
    } catch (e) {
      console.log("Could not log WS client details:", e && e.message ? e.message : e);
    }
    const subscriptions = new Map(); // Track this client’s subscriptions

    ws.on("message", (data) => {
      try {
        console.log("📩 Received message from frontend:", data.toString());
        const messageData = JSON.parse(data);
        const { type, userId, cardId, tags, jobId } = messageData;

        // ---- Tag subscriptions ----
        if ((type === "singleValue" || type === "trend") && Array.isArray(tags)) {
          tags.forEach((tagId) => {
            if (!tagSubscriptions.has(tagId)) {
              tagSubscriptions.set(tagId, new Map());
            }
            const subId = uuid.v4();
            tagSubscriptions.get(tagId).set(subId, { ws, userId, cardId, type });
            subscriptions.set(subId, { type: "tag", tagId });

            console.log(`✅ Subscribed to tagId: ${tagId} (subId: ${subId})`);
          });
        }

        // ---- Job completion subscription ----
        if (type === "jobCompletion" && jobId) {
          if (!jobSubscriptions.has(jobId)) {
            jobSubscriptions.set(jobId, new Map());
          }
          const subsForJob = jobSubscriptions.get(jobId);
          // Avoid duplicate subscriptions from the same ws/user for the same job
          let alreadySubscribed = false;
          subsForJob.forEach((entry) => {
            if (entry.ws === ws && entry.userId === userId) {
              alreadySubscribed = true;
            }
          });
          if (!alreadySubscribed) {
            const subId = uuid.v4();
            subsForJob.set(subId, { ws, userId, jobId });
            subscriptions.set(subId, { type: "job", jobId });
            console.log(`✅ Subscribed to jobId: ${jobId} (subId: ${subId})`);
          } else {
            console.log(`🔁 Duplicate subscription ignored for jobId: ${jobId} (userId: ${userId})`);
          }
        }

        // ---- Job completion unsubscription ----
        if (type === "unsubscribeJob" && jobId) {
          const subsForJob = jobSubscriptions.get(jobId);
          if (subsForJob) {
            const toDelete = [];
            subsForJob.forEach((entry, sid) => {
              if (entry.ws === ws && (!userId || entry.userId === userId)) {
                toDelete.push(sid);
              }
            });
            toDelete.forEach((sid) => subsForJob.delete(sid));
            if (subsForJob.size === 0) jobSubscriptions.delete(jobId);
            console.log(`🗑️ Unsubscribed ${toDelete.length} entries for jobId=${jobId}`);
          }
        }
      } catch (err) {
        console.error("❌ Error processing message:", err.message);
      }
    });

    ws.on("close", () => {
      // Clean up subscriptions
      subscriptions.forEach((subscription, subId) => {
        if (subscription.type === "tag") {
          removeTagSubscription(subscription.tagId, subId);
        } else if (subscription.type === "job") {
          removeJobSubscription(subscription.jobId, subId);
        }
      });
      console.log("🔌 WebSocket closed — cleaned up subscriptions");
    });
  });

  return wss;
}

// ----------------------------
// Cleanup Functions
// ----------------------------
function removeTagSubscription(tagId, subId) {
  if (tagSubscriptions.has(tagId)) {
    const subs = tagSubscriptions.get(tagId);
    subs.delete(subId);
    if (subs.size === 0) {
      tagSubscriptions.delete(tagId);
    }
    console.log(`🗑️ Removed tag subscription: tagId=${tagId}, subId=${subId}`);
  }
}

function removeJobSubscription(jobId, subId) {
  if (jobSubscriptions.has(jobId)) {
    const subs = jobSubscriptions.get(jobId);
    subs.delete(subId);
    if (subs.size === 0) {
      jobSubscriptions.delete(jobId);
    }
    console.log(`🗑️ Removed job subscription: jobId=${jobId}, subId=${subId}`);
  }
}

// ----------------------------
// Redis Subscriptions (shared subscriber)
// ----------------------------
(async () => {
  try {
    sharedRedisSubscriber = await getSharedSubscriber();

    // Subscribe to tagUpdates (node-redis v4 style: message callback)
    try {
      await sharedRedisSubscriber.subscribe('tagUpdates', (message) => {
        try {
          const data = JSON.parse(message);
          const { tagId, value, oldValue, currentTime, timestamp } = data;
          
          console.log(`📡 Received tag update: tagId=${tagId}, oldValue=${oldValue}, newValue=${value}`);
          
          // Forward to WebSocket clients
          const subs = tagSubscriptions.get(tagId);
          if (subs) {
            subs.forEach(({ ws, cardId }) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ cardId, tagId, value, currentTime }));
                console.log(`📤 Sent tag update to cardId=${cardId}, tagId=${tagId}`);
              }
            });
          }

          // Check and trigger notifications (async, non-blocking)
          const tagOperations = [{
            tagId,
            value,
            oldValue,
            timestamp: timestamp || currentTime || new Date()
          }];
          
          setImmediate(() => {
            checkAndTriggerNotifications(tagOperations, timestamp || currentTime || new Date())
              .catch(err => console.error('❌ Notification check failed:', err.message));
          });
        } catch (e) {
          console.error('❌ Error handling tagUpdates message:', e && e.message ? e.message : e);
        }
      });
      console.log('📡 Subscribed to Redis channel: tagUpdates');
    } catch (e) {
      console.error('❌ Redis tagUpdates subscribe failed:', e && e.message ? e.message : e);
    }

    // Subscribe to notifications channel
    try {
      await sharedRedisSubscriber.subscribe('notifications', (message) => {
        try {
          const data = JSON.parse(message);
          const { type, userId, message: notificationMessage, timestamp, notificationId } = data;
          
          console.log(`🔔 Received notification for userId=${userId}`);
          
          // Send notification to all connected clients for this user
          if (wss && wss.clients) {
            wss.clients.forEach((ws) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'notification',
                  userId,
                  message: notificationMessage,
                  timestamp,
                  notificationId
                }));
                console.log(`📤 Sent notification to client for userId=${userId}`);
              }
            });
          }
        } catch (e) {
          console.error('❌ Error handling notifications message:', e && e.message ? e.message : e);
        }
      });
      console.log('📡 Subscribed to Redis channel: notifications');
    } catch (e) {
      console.error('❌ Redis notifications subscribe failed:', e && e.message ? e.message : e);
    }
  } catch (e) {
    console.error('❌ Failed to initialize shared Redis subscriber in websocketServer:', e && e.message ? e.message : e);
  }
})();

// ----------------------------
// Exports
// ----------------------------
module.exports = {
  setupWebSocket,
  tagSubscriptions,
  jobSubscriptions,
};
