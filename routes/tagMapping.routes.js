const express = require("express");
const router = express.Router();
const tagMappingController = require("../controllers/tagMapping.controller");
const multer = require("multer");

// Configure multer for handling 2 files
const upload = multer({ 
  dest: "uploads/",
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit per file
    files: 2 // Accept 2 files
  },
  fileFilter: (req, file, cb) => {
    // Accept Excel files only
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

// Error handling middleware
const handleUploadErrors = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: 'File size exceeds the 100MB limit.',
        maxSize: '100MB'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files',
        message: 'Maximum 2 files can be uploaded (mapping file and data file).'
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

// Route: Convert SCADA IDs to APP IDs
router.post(
  "/convert-scada-to-app",
  upload.fields([
    { name: 'mappingFile', maxCount: 1 },
    { name: 'dataFile', maxCount: 1 }
  ]),
  handleUploadErrors,
  tagMappingController.convertScadaToAppIds
);

module.exports = router;

