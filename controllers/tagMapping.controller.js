const XLSX = require("xlsx");
const fs = require("fs");

/**
 * Convert SCADA IDs to APP IDs in Excel header
 * 
 * @route POST /api/tag-mapping/convert-scada-to-app
 * @param {File} mappingFile - Excel file with columns: ID_SCADA, ID_APP, TAG_NAME
 * @param {File} dataFile - Excel file with header containing SCADA IDs
 * @returns {File} Converted Excel file with APP IDs in header
 */
exports.convertScadaToAppIds = async (req, res) => {
  try {
    const files = req.files;
    
    // Validate both files are uploaded
    if (!files || !files.mappingFile || !files.dataFile) {
      return res.status(400).json({
        error: "Both files are required",
        message: "Please upload both the mapping file and the data file"
      });
    }

    const mappingFile = files.mappingFile[0];
    const dataFile = files.dataFile[0];

    console.log(`📁 Processing mapping file: ${mappingFile.originalname}`);
    console.log(`📁 Processing data file: ${dataFile.originalname}`);

    // Step 1: Read mapping file and create SCADA -> APP ID map
    const mappingWorkbook = XLSX.readFile(mappingFile.path);
    const mappingSheetName = mappingWorkbook.SheetNames[0];
    const mappingSheet = XLSX.utils.sheet_to_json(mappingWorkbook.Sheets[mappingSheetName], { header: 1 });

    // Build mapping: { scadaId: appId }
    const scadaToAppMap = new Map();
    const mappingHeader = mappingSheet[0]; // Row 1: [ID_SCADA, ID_APP, TAG_NAME]
    const mappingRows = mappingSheet.slice(1); // Data starts from row 2

    console.log(`📋 Mapping file header:`, mappingHeader);
    console.log(`📊 Found ${mappingRows.length} mapping entries`);

    // Validate mapping file structure
    if (mappingHeader.length < 2) {
      return res.status(400).json({
        error: "Invalid mapping file structure",
        message: "Mapping file must have at least 2 columns: ID_SCADA and ID_APP"
      });
    }

    // Build the mapping
    let mappedCount = 0;
    for (let i = 0; i < mappingRows.length; i++) {
      const row = mappingRows[i];
      const scadaId = row[0]; // Column A: ID_SCADA
      const appId = row[1];   // Column B: ID_APP

      if (scadaId != null && appId != null) {
        scadaToAppMap.set(String(scadaId), String(appId));
        mappedCount++;
      }
    }

    console.log(`✅ Built mapping for ${mappedCount} SCADA IDs`);

    // Step 2: Read data file
    const dataWorkbook = XLSX.readFile(dataFile.path);
    const dataSheetName = dataWorkbook.SheetNames[0];
    const dataSheet = XLSX.utils.sheet_to_json(dataWorkbook.Sheets[dataSheetName], { header: 1 });

    const dataHeader = dataSheet[0]; // Header row with SCADA IDs
    const dataRows = dataSheet.slice(1); // Actual data rows

    console.log(`📋 Data file has ${dataHeader.length} columns and ${dataRows.length} rows`);

    // Step 3: Convert header SCADA IDs to APP IDs
    const convertedHeader = dataHeader.map((cell, index) => {
      // First column is usually "Timestamp", keep it as is
      if (index === 0) {
        return cell;
      }

      let cellValue = String(cell);
      let scadaId = cellValue;
      
      // Check if cell has "Tag_XX" format and extract the number
      const tagMatch = cellValue.match(/^Tag_(\d+)$/i);
      if (tagMatch) {
        scadaId = tagMatch[1]; // Extract the number after "Tag_"
        console.log(`📝 Detected Tag format: "${cellValue}" → extracted SCADA ID: ${scadaId}`);
      }
      
      // Check if this SCADA ID exists in mapping
      if (scadaToAppMap.has(scadaId)) {
        const appId = scadaToAppMap.get(scadaId);
        console.log(`🔄 Converting column ${index}: "${cellValue}" (SCADA ${scadaId}) → APP ${appId}`);
        return appId;
      } else {
        // If not found in mapping, keep original value
        console.log(`⚠️  Column ${index}: "${cellValue}" (SCADA ${scadaId}) not found in mapping, keeping original`);
        return cell;
      }
    });

    // Count conversions
    const conversionsCount = dataHeader.filter((cell, index) => {
      if (index === 0) return false; // Skip Timestamp column
      
      let cellValue = String(cell);
      let scadaId = cellValue;
      
      // Extract number from "Tag_XX" format if present
      const tagMatch = cellValue.match(/^Tag_(\d+)$/i);
      if (tagMatch) {
        scadaId = tagMatch[1];
      }
      
      return scadaToAppMap.has(scadaId);
    }).length;

    const notFoundCount = dataHeader.length - 1 - conversionsCount; // -1 for Timestamp column

    console.log(`✅ Converted ${conversionsCount} SCADA IDs to APP IDs`);
    console.log(`⚠️  ${notFoundCount} SCADA IDs not found in mapping (kept original)`);

    // Step 4: Create new Excel with converted header
    const convertedData = [convertedHeader, ...dataRows];
    const convertedWorkbook = XLSX.utils.book_new();
    const convertedSheet = XLSX.utils.aoa_to_sheet(convertedData);
    XLSX.utils.book_append_sheet(convertedWorkbook, convertedSheet, "Converted Data");

    // Step 5: Write to buffer and send to client
    const buffer = XLSX.write(convertedWorkbook, { type: 'buffer', bookType: 'xlsx' });

    // Clean up uploaded files
    fs.unlink(mappingFile.path, err => {
      if (err) console.warn("⚠️  Mapping file deletion failed:", err.message);
    });
    fs.unlink(dataFile.path, err => {
      if (err) console.warn("⚠️  Data file deletion failed:", err.message);
    });

    // Send converted file
    const originalFilename = dataFile.originalname.replace(/\.(xlsx|xls|csv)$/i, '');
    const convertedFilename = `${originalFilename}_converted_app_ids.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${convertedFilename}"`);

    console.log(`✅ Conversion completed successfully!`);
    console.log(`📦 Sending file: ${convertedFilename}`);

    return res.status(200).send(buffer);

  } catch (error) {
    console.error("❌ Tag Mapping Conversion Error:", error);
    
    // Clean up files on error
    if (req.files) {
      if (req.files.mappingFile && req.files.mappingFile[0]) {
        fs.unlink(req.files.mappingFile[0].path, () => {});
      }
      if (req.files.dataFile && req.files.dataFile[0]) {
        fs.unlink(req.files.dataFile[0].path, () => {});
      }
    }

    return res.status(500).json({ 
      error: "Conversion failed", 
      message: error.message 
    });
  }
};

