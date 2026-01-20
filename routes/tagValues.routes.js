const express = require("express");
const router = express.Router();
const tagValuesController = require("../controllers/tagValues.controller");
const multer = require("multer");

// Error handling middleware for file uploads
const handleUploadErrors = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: 'File size exceeds the 100MB limit. Please compress or split your file.',
        maxSize: '100MB'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files',
        message: 'Only one file can be uploaded at a time.'
      });
    }
  }
  if (error.message === 'Only Excel and CSV files are allowed') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Only Excel (.xlsx, .xls) and CSV files are supported.'
    });
  }
  next(error);
};

// Configure multer with size limits for large Excel files (single file)
const upload = multer({ 
  dest: "uploads/",
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Accept Excel files and CSV
    const allowedMimes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'), false);
    }
  }
});

// Configure multer for multiple files (merge operation)
const uploadMultiple = multer({ 
  dest: "uploads/",
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit per file
    files: 10 // Allow up to 10 files
  },
  fileFilter: (req, file, cb) => {
    // Accept Excel files only (no CSV for merge)
    const allowedMimes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'), false);
    }
  }
});

// Merge multiple Excel files - Helper tool for combining tag data by timestamp
router.post(
  "/merge-tag-excel",
  uploadMultiple.array("files", 10), // Allow up to 10 files
  handleUploadErrors,
  tagValuesController.mergeTagExcel
);

// Gap-filling operation - Step 1: Preview missing tag values
router.post(
  "/preview-missing",
  upload.single("file"),
  handleUploadErrors,
  tagValuesController.previewMissingTagValues
);

// Gap-filling operation - Step 2: Confirm and insert missing tag values
router.post(
  "/confirm-insert",
  tagValuesController.confirmAndInsertMissingTagValues
);

router.post(
  "/upload-tag-values",
  upload.single("file"),
  handleUploadErrors,
  tagValuesController.uploadTagValues
);

// CRUD Endpoints
router.post("/", tagValuesController.createTagValue);
router.get("/:id", tagValuesController.getTagValueById);
router.put("/:id", tagValuesController.updateTagValue);
router.put("/update/bulk", tagValuesController.updateTagValuesInRange);

router.delete("/:id", tagValuesController.deleteTagValue);
router.get("/date/values", tagValuesController.getTagValuesByDateRange);
// Get all tag values paginated and sorted by date
router.get("/", tagValuesController.getAllTagValuesPaginated);

module.exports = router;