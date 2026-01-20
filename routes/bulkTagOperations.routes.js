const express = require("express");
const router = express.Router();
const bulkTagOperationsController = require("../controllers/bulkTagOperations.controller");
const { 
    validateBulkTagOperations, 
    validateBulkOperationPermissions,
    rateLimitBulkOperations 
} = require("../middlewares/validateBulkTagOperations");

/**
 * @route   POST /api/bulk-tag-operations
 * @desc    Execute bulk tag operations for operations teams
 * @access  Public (you may want to add authentication middleware)
 * @body    {
 *   prog: number,           // Program identifier
 *   batchactive: number,    // Batch active state (0 or 1)
 *   sku: string,           // SKU identifier
 *   createdAt: string,     // Optional timestamp (ISO format)
 *   tags: {                // Dynamic tag operations
 *     tagId: value,
 *     tagId: value,
 *     ...
 *   }
 * }
 * 
 * Example:
 * {
 *   "prog": 1,
 *   "batchactive": 1,
 *   "sku": "SKU123",
 *   "createdAt": "2024-01-15T10:30:00.000Z",
 *   "tags": {
 *     "101": 1.5,
 *     "102": 0,
 *     "103": 85.2
 *   }
 * }
 */
router.post("/", 
    rateLimitBulkOperations,
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    bulkTagOperationsController.createBulkTagOperations
);

/**
 * @route   GET /api/bulk-tag-operations/history
 * @desc    Get bulk operation history for monitoring and debugging
 * @access  Public (you may want to add authentication middleware)
 * @query   startDate, endDate, limit, offset
 */
router.get("/history", bulkTagOperationsController.getBulkOperationHistory);

/**
 * @route   POST /api/bulk-tag-operations/bl2
 * @desc    Execute bulk tag operations for BL2 line
 * @access  Public (you may want to add authentication middleware)
 * @body    {
 *   createdAt: string,     // Optional timestamp (ISO format)
 *   tags: {                // Dynamic tag operations for BL2
 *     tagId: value,
 *     tagId: value,
 *     ...
 *   }
 * }
 * 
 * Example:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "145": 1,    // BL2_Filler_WS_Cur_State
 *     "146": 2,    // BL2_Filler_WS_Cur_Mode
 *     "147": 1,    // BL2_Filler_WS_Cur_Prog (prog)
 *     "143": 1     // BL2_BatchActive (batchactive)
 *   }
 * }
 */
router.post("/bl2", 
    rateLimitBulkOperations,
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    bulkTagOperationsController.createBulkTagOperationsBL2
);

/**
 * @route   POST /api/bulk-tag-operations/ems
 * @desc    Execute bulk tag operations for EMS energy meters
 * @access  Public (you may want to add authentication middleware)
 * @body    {
 *   createdAt: string,     // Optional timestamp (ISO format)
 *   tags: {                // Dynamic tag operations for EMS meters
 *     tagId: value,
 *     tagId: value,
 *     ...
 *   }
 * }
 * 
 * Example:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "158": 1250.5,  // G1_KWH
 *     "159": 980.2,   // G2_KWH
 *     "160": 750.8,   // G3_KWH
 *     "161": 1100.3   // G4_KWH
 *   }
 * }
 */
router.post("/ems", 
    rateLimitBulkOperations,
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    bulkTagOperationsController.createBulkTagOperationsEMS
);

/**
 * @route   POST /api/bulk-tag-operations/rim
 * @desc    Execute bulk tag operations for RIM L1 line
 * @access  Public (you may want to add authentication middleware)
 * @body    {
 *   createdAt: string,     // Optional timestamp (ISO format)
 *   tags: {                // Dynamic tag operations for RIM L1
 *     tagId: value,
 *     tagId: value,
 *     ...
 *   }
 * }
 * 
 * Example:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "182": 1,    // RIM L1_Batch_Active (batchactive)
 *     "187": 1,    // RIM L1_Filler_WS_Cur_Prog (prog)
 *     ...
 *   }
 * }
 */
router.post("/rim", 
    rateLimitBulkOperations,
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    bulkTagOperationsController.createBulkTagOperationsRIM
);

/**
 * @route   POST /api/bulk-tag-operations/rim-l2
 * @desc    Execute bulk tag operations for RIM L2 line (Bardi-10-L2, Line 27)
 * @access  Public (you may want to add authentication middleware)
 * @body    {
 *   createdAt: string,     // Optional timestamp (ISO format)
 *   tags: {                // Dynamic tag operations for RIM L2
 *     tagId: value,
 *     tagId: value,
 *     ...
 *   }
 * }
 * 
 * Example:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "295": 1,    // L2_BatchActive (batchactive) - Line 27
 *     "296": 1,    // L2_Program (prog) - Line 27
 *     ...
 *   }
 * }
 */
router.post("/rim-l2", 
    rateLimitBulkOperations,
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    bulkTagOperationsController.createBulkTagOperationsRIML3
);

/**
 * @route   POST /api/bulk-tag-operations/rim-l3
 * @desc    Execute bulk tag operations for RIM L3 line (Bardi-23-L3, Line 26)
 * @access  Public (you may want to add authentication middleware)
 * @body    {
 *   createdAt: string,     // Optional timestamp (ISO format)
 *   tags: {                // Dynamic tag operations for RIM L3
 *     tagId: value,
 *     tagId: value,
 *     ...
 *   }
 * }
 * 
 * Example:
 * {
 *   "createdAt": "2025-06-12T07:53:00.000Z",
 *   "tags": {
 *     "274": 1,    // RIM L3_Batch_Active (batchactive) - Line 26
 *     "292": 1,    // RIM L3_Washer&Filler_WS_Cur_Prog (prog) - Line 26
 *     ...
 *   }
 * }
 */
router.post("/rim-l3", 
    rateLimitBulkOperations,
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    bulkTagOperationsController.createBulkTagOperationsRIML2
);

/**
 * @route   POST /api/bulk-tag-operations/rim-ems
 * @desc    Execute bulk tag operations for RIM EMS energy meters
 * @access  Public (you may want to add authentication middleware)
 * @body    {
 *   createdAt: string,     // Optional timestamp (ISO format)
 *   tags: {                // Dynamic tag operations for RIM EMS meters
 *     tagId: value,
 *     tagId: value,
 *     ...
 *   }
 * }
 * 
 * Example:
 * {
 *   "createdAt": "2025-12-16T10:00:00.000Z",
 *   "tags": {
 *     "348": 1250.5,  // Krones2_Blower_kwh
 *     "349": 980.2,   // Krones2_Kwh
 *     "350": 750.8,   // G1_kWh
 *     "351": 1100.3,  // G2_kWh
 *     "352": 920.4,   // G3_kWh
 *     "353": 1050.7,  // G4_kWh
 *     "354": 880.9,   // G5_kWh
 *     "355": 1200.1   // G6_kWh
 *   }
 * }
 */
router.post("/rim-ems", 
    rateLimitBulkOperations,
    validateBulkTagOperations,
    validateBulkOperationPermissions,
    bulkTagOperationsController.createBulkTagOperationsRIMEMS
);

module.exports = router;
