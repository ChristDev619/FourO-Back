/**
 * Configuration for bulk tag operations
 * These can be adjusted based on your system requirements
 */
const BULK_OPERATION_CONFIG = {
    MAX_REQUESTS_PER_MINUTE: process.env.MAX_REQUESTS_PER_MINUTE || 30 // Rate limiting only
};

/**
 * Validation middleware for bulk tag operations
 * Ensures the request body contains properly formatted data
 */

const validateBulkTagOperations = (req, res, next) => {
    try {
        const { createdAt, tags } = req.body;

        // Array to collect validation errors
        const errors = [];

        // Extract prog and batchactive from tags for validation
        const prog = tags ? tags['131'] : undefined;
        const batchactive = tags ? tags['140'] : undefined;

        // Validate prog (tag 131) if provided
        if (prog !== undefined && typeof prog !== 'number' && !Number.isInteger(Number(prog))) {
            errors.push("Tag 131 (prog) must be a valid integer");
        }

        // Validate batchactive (tag 140) if provided  
        if (batchactive !== undefined && ![0, 1].includes(Number(batchactive))) {
            errors.push("Tag 140 (batchactive) must be 0 or 1");
        }

        // SKU is no longer required - it will be determined from RECIPE tag

        // Validate optional createdAt timestamp
        if (createdAt) {
            const timestamp = new Date(createdAt);
            if (isNaN(timestamp.getTime())) {
                errors.push("'createdAt' must be a valid ISO datetime string");
            }
        }

        // Validate tags object
        if (!tags) {
            errors.push("'tags' object is required");
        } else if (typeof tags !== 'object' || Array.isArray(tags)) {
            errors.push("'tags' must be an object");
        } else {
            const tagEntries = Object.entries(tags);
            
            if (tagEntries.length === 0) {
                errors.push("'tags' object must contain at least one tag operation");
            }

            // Validate each tag entry
            tagEntries.forEach(([tagId, value], index) => {
                // Validate tagId
                const numericTagId = Number(tagId);
                if (!Number.isInteger(numericTagId) || numericTagId <= 0) {
                    errors.push(`Tag at index ${index}: tagId '${tagId}' must be a positive integer`);
                }

                // Validate value
                if (typeof value !== 'number' && typeof value !== 'string') {
                    errors.push(`Tag at index ${index}: value must be a number or string`);
                } else if (typeof value === 'string' && value.trim().length === 0) {
                    errors.push(`Tag at index ${index}: string values cannot be empty`);
                } else if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) {
                    errors.push(`Tag at index ${index}: numeric values must be finite numbers`);
                }
            });


        }

        // If there are validation errors, return them
        if (errors.length > 0) {
            return res.status(400).json({
                error: "Validation failed",
                details: errors,
                example: {

                    createdAt: "2025-06-12T07:53:00.000Z", // Optional
                    tags: {
                        "69": 0,
                        "70": 16,
                        "131": 1,    // prog (KL1_Filler_CurProg)
                        "140": 1     // batchactive (KL1_BatchActive)
                    }
                }
            });
        }

        // Normalize data types for downstream processing
        // No SKU trimming needed - SKU comes from RECIPE tag

        // Convert tag keys to integers and validate values
        const normalizedTags = {};
        Object.entries(tags).forEach(([tagId, value]) => {
            const numericTagId = Number(tagId);
            normalizedTags[numericTagId] = typeof value === 'string' ? value.trim() : Number(value);
        });
        req.body.tags = normalizedTags;

        next();

    } catch (error) {
        console.error("Error in bulk tag operations validation:", error);
        return res.status(400).json({
            error: "Invalid request format",
            details: ["Request body must be valid JSON"]
        });
    }
};

/**
 * Additional middleware to validate that the operation is allowed
 * This can be extended with business logic, authentication, rate limiting, etc.
 */
const validateBulkOperationPermissions = (req, res, next) => {
    try {
        // Example business rules - customize based on your requirements
        const { tags } = req.body;
        const errors = [];

        // Extract prog and batchactive from tags
        const prog = tags ? (tags['131'] || tags['140'] || 1) : 1;  // Use batchactive as prog fallback
        const batchactive = tags ? tags['140'] : 0;



        // Example: Limit batch operations to certain programs (temporarily disabled for testing)
        // if (batchactive === 1 && ![1, 2, 3, 4].includes(prog)) {
        //     errors.push(`Batch activation not allowed for program ${prog}`);
        // }



        if (errors.length > 0) {
            return res.status(403).json({
                error: "Operation not permitted",
                details: errors
            });
        }

        next();

    } catch (error) {
        console.error("Error in bulk operation permissions validation:", error);
        return res.status(500).json({
            error: "Permission validation failed"
        });
    }
};

/**
 * Rate limiting middleware for bulk operations
 * Prevents abuse by limiting the number of bulk operations per time window
 */
const rateLimitBulkOperations = (() => {
    const requestCounts = new Map();
    const WINDOW_SIZE = 60 * 1000; // 1 minute
    const MAX_REQUESTS = BULK_OPERATION_CONFIG.MAX_REQUESTS_PER_MINUTE; // Dynamic rate limit

    return (req, res, next) => {
        const clientId = req.ip || 'unknown';
        const now = Date.now();
        
        // Clean up old entries
        for (const [id, data] of requestCounts.entries()) {
            if (now - data.windowStart > WINDOW_SIZE) {
                requestCounts.delete(id);
            }
        }

        // Get or create client data
        let clientData = requestCounts.get(clientId);
        if (!clientData || now - clientData.windowStart > WINDOW_SIZE) {
            clientData = { count: 0, windowStart: now };
            requestCounts.set(clientId, clientData);
        }

        // Check rate limit
        if (clientData.count >= MAX_REQUESTS) {
            return res.status(429).json({
                error: "Rate limit exceeded",
                details: [`Too many bulk operations. Limit: ${MAX_REQUESTS} per minute`],
                retryAfter: Math.ceil((WINDOW_SIZE - (now - clientData.windowStart)) / 1000)
            });
        }

        // Increment counter
        clientData.count++;
        
        next();
    };
})();

module.exports = {
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    rateLimitBulkOperations
};
