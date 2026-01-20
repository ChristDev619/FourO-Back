const { Line, LineMachine, Machine, Tags, TagValues, Meters, sequelize, Op } = require("../dbInit");
const moment = require("moment");

/**
 * Analyze data gaps for a specific line over a date range
 * 
 * @route POST /api/data-gap-inspector/analyze
 * @body {
 *   lineId: number,
 *   startDate: string (ISO format),
 *   endDate: string (ISO format)
 * }
 * 
 * @returns {
 *   summary: {
 *     totalMinutesExpected: number,
 *     minutesWithCompleteData: number,
 *     minutesWithMissingData: number,
 *     totalTagsMonitored: number,
 *     dataCompleteness: number (percentage)
 *   },
 *   missingMinutes: [{
 *     timestamp: string,
 *     missingTagsCount: number,
 *     totalTags: number,
 *     missingTagIds: number[],
 *     isCompletelyMissing: boolean (true if ALL tags missing)
 *   }]
 * }
 */
exports.analyzeDataGaps = async (req, res) => {
    try {
        const { lineId, startDate, endDate } = req.body;

        // Validation
        if (!lineId) {
            return res.status(400).json({ error: "lineId is required" });
        }
        if (!startDate || !endDate) {
            return res.status(400).json({ error: "startDate and endDate are required" });
        }

        const start = moment(startDate);
        const end = moment(endDate);

        if (!start.isValid() || !end.isValid()) {
            return res.status(400).json({ error: "Invalid date format. Use ISO format (YYYY-MM-DD)" });
        }

        if (end.isBefore(start)) {
            return res.status(400).json({ error: "endDate must be after startDate" });
        }

        // Check max date range (1 month = ~44,640 minutes)
        const diffInDays = end.diff(start, 'days');
        if (diffInDays > 31) {
            return res.status(400).json({ 
                error: "Date range cannot exceed 31 days (1 month). Please select a shorter range.",
                maxDays: 31,
                requestedDays: diffInDays
            });
        }

        console.log(`🔍 [DataGapInspector] Analyzing line ${lineId} from ${start.format('YYYY-MM-DD HH:mm')} to ${end.format('YYYY-MM-DD HH:mm')}`);

        // Step 1: Verify line exists
        const line = await Line.findByPk(lineId);
        if (!line) {
            return res.status(404).json({ error: `Line with ID ${lineId} not found` });
        }

        // Step 2: Get all tags for this line from all sources:
        // 1. Tags directly on the line (taggableType: 'line')
        // 2. Tags on machines associated with the line (taggableType: 'machine')
        // 3. Tags on meters associated with the line (taggableType: 'meter')
        
        const regularTagIds = [];
        const emsTagIds = [];
        const tagDetailsMap = new Map();

        // 1. Get tags directly on the line
        const lineTags = await Tags.findAll({
            where: {
                taggableType: 'line',
                taggableId: lineId
            },
            attributes: ['id', 'name', 'ref', 'taggableType']
        });

        console.log(`📋 [DataGapInspector] Found ${lineTags.length} tags directly on line ${lineId}`);

        lineTags.forEach(tag => {
            const tagDetail = {
                id: tag.id,
                name: tag.name,
                ref: tag.ref,
                type: tag.taggableType
            };
            tagDetailsMap.set(tag.id, tagDetail);
            regularTagIds.push(tag.id); // Line tags are regular (1-min)
        });

        // 2. Get tags through LineMachines → Machines → Tags
        // Fetch LineMachines first (without includes to avoid association errors)
        const lineMachines = await LineMachine.findAll({
            where: { lineId },
            attributes: ['machineId']
        });

        // Extract unique machine IDs
        const machineIds = [...new Set(lineMachines.map(lm => lm.machineId).filter(id => id !== null))];

        console.log(`🔧 [DataGapInspector] Found ${lineMachines.length} LineMachine entries, ${machineIds.length} unique machines: [${machineIds.join(', ')}]`);

        if (machineIds.length > 0) {
            // Fetch tags for these machines directly
            const machineTags = await Tags.findAll({
                where: {
                    taggableType: 'machine',
                    taggableId: { [Op.in]: machineIds }
                },
                attributes: ['id', 'name', 'ref', 'taggableType']
            });

            console.log(`📋 [DataGapInspector] Found ${machineTags.length} tags on machines [${machineIds.join(', ')}]`);

            machineTags.forEach(tag => {
                // Skip if already added
                if (tagDetailsMap.has(tag.id)) return;
                
                const tagDetail = {
                    id: tag.id,
                    name: tag.name,
                    ref: tag.ref,
                    type: tag.taggableType
                };
                tagDetailsMap.set(tag.id, tagDetail);
                regularTagIds.push(tag.id); // Machine tags are regular (1-min)
            });
        }

        // 3. Get tags on meters associated with the line
        // First, get all meters that might be associated with this line
        // Meters are typically associated through locations, but we'll get all meter tags
        // that could be related to this line's location
        const lineLocation = await Line.findByPk(lineId, {
            attributes: ['locationId']
        });

        if (lineLocation && lineLocation.locationId) {
            console.log(`📍 [DataGapInspector] Line ${lineId} is in location ${lineLocation.locationId}`);
            
            // Get meters for this location
            const meters = await Meters.findAll({
                where: { locationId: lineLocation.locationId },
                attributes: ['id']
            });

            const meterIds = meters.map(m => m.id);
            console.log(`⚡ [DataGapInspector] Found ${meters.length} meters in location ${lineLocation.locationId}: [${meterIds.join(', ')}]`);
            
            if (meterIds.length > 0) {
                // Get all tags for these meters
                const meterTags = await Tags.findAll({
                    where: {
                        taggableType: 'meter',
                        taggableId: { [Op.in]: meterIds }
                    },
                    attributes: ['id', 'name', 'ref', 'taggableType']
                });

                console.log(`📋 [DataGapInspector] Found ${meterTags.length} EMS tags on meters [${meterIds.join(', ')}]`);

                meterTags.forEach(tag => {
                    // Skip if already added
                    if (tagDetailsMap.has(tag.id)) return;
                    
                    const tagDetail = {
                        id: tag.id,
                        name: tag.name,
                        ref: tag.ref,
                        type: tag.taggableType
                    };
                    tagDetailsMap.set(tag.id, tagDetail);
                    emsTagIds.push(tag.id); // Meter tags are EMS (15-min)
                });
            }
        }

        const totalTags = regularTagIds.length + emsTagIds.length;
        
        if (totalTags === 0) {
            return res.status(400).json({ 
                error: "No tags found for this line. Line may not have any machines or tags configured.",
                lineId,
                lineName: line.name
            });
        }

        console.log(`📊 Found ${totalTags} tags for line "${line.name}": ${regularTagIds.length} regular (1-min) + ${emsTagIds.length} EMS (15-min)`);

        // Step 3: Generate expected intervals for regular tags (every 1 minute)
        const expectedRegularMinutes = [];
        if (regularTagIds.length > 0) {
            let current = start.clone().startOf('minute');
            const endMinute = end.clone().startOf('minute');
            while (current.isSameOrBefore(endMinute)) {
                expectedRegularMinutes.push(current.format('YYYY-MM-DD HH:mm:00'));
                current.add(1, 'minute');
            }
        }

        // Step 4: Generate expected intervals for EMS tags (every 15 minutes: :00, :15, :30, :45)
        const expectedEMSIntervals = [];
        if (emsTagIds.length > 0) {
            let current = start.clone().startOf('minute');
            const endMinute = end.clone().startOf('minute');
            
            // Round to nearest 15-minute interval
            const currentMinute = current.minute();
            const remainder = currentMinute % 15;
            if (remainder !== 0) {
                current.add(15 - remainder, 'minutes');
            }
            
            while (current.isSameOrBefore(endMinute)) {
                expectedEMSIntervals.push(current.format('YYYY-MM-DD HH:mm:00'));
                current.add(15, 'minutes');
            }
        }

        console.log(`⏱️  Regular tags: ${expectedRegularMinutes.length} minutes × ${regularTagIds.length} tags`);
        console.log(`⏱️  EMS tags: ${expectedEMSIntervals.length} intervals × ${emsTagIds.length} tags`);

        // Step 5: Query TagValues for regular tags (1-minute intervals)
        let regularTagValuesData = [];
        if (regularTagIds.length > 0) {
            regularTagValuesData = await TagValues.findAll({
                attributes: [
                    [sequelize.fn('DATE_FORMAT', sequelize.col('createdAt'), '%Y-%m-%d %H:%i:00'), 'minute'],
                    'tagId',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count']
                ],
                where: {
                    tagId: { [Op.in]: regularTagIds },
                    createdAt: {
                        [Op.between]: [
                            start.format('YYYY-MM-DD HH:mm:00'),
                            end.format('YYYY-MM-DD HH:mm:59')
                        ]
                    }
                },
                group: ['minute', 'tagId'],
                raw: true
            });
        }

        // Step 6: Query TagValues for EMS tags (15-minute intervals with tolerance ±2 minutes)
        let emsTagValuesData = [];
        if (emsTagIds.length > 0) {
            // Query with wider range to account for tolerance (±2 minutes)
            const emsStart = start.clone().subtract(2, 'minutes');
            const emsEnd = end.clone().add(2, 'minutes');
            
            // Query without grouping first to get exact timestamps for tolerance matching
            emsTagValuesData = await TagValues.findAll({
                attributes: [
                    'tagId',
                    'createdAt'
                ],
                where: {
                    tagId: { [Op.in]: emsTagIds },
                    createdAt: {
                        [Op.between]: [
                            emsStart.toDate(),
                            emsEnd.toDate()
                        ]
                    }
                },
                raw: true,
                order: [['createdAt', 'ASC']]
            });
        }

        console.log(`✅ Regular tags query: ${regularTagValuesData.length} minute-tag combinations`);
        console.log(`✅ EMS tags query: ${emsTagValuesData.length} minute-tag combinations`);

        // Step 7: Build maps of existing data for regular tags
        const regularExistingDataMap = new Map();
        regularTagValuesData.forEach(row => {
            const minute = row.minute;
            if (!regularExistingDataMap.has(minute)) {
                regularExistingDataMap.set(minute, new Set());
            }
            regularExistingDataMap.get(minute).add(row.tagId);
        });

        // Step 8: Build maps of existing data for EMS tags (with tolerance matching)
        const emsExistingDataMap = new Map();
        emsTagValuesData.forEach(row => {
            const rowTimestamp = moment(row.createdAt);
            const rowMinuteValue = rowTimestamp.minute();
            const rowSecond = rowTimestamp.second();
            
            // Match to nearest 15-minute interval (:00, :15, :30, :45)
            // Allow tolerance of ±2 minutes (or up to 20 minutes inspection window)
            const remainder = rowMinuteValue % 15;
            let targetInterval;
            
            // Calculate distance to nearest 15-minute mark
            if (remainder <= 2) {
                // Within 2 minutes before a 15-min mark, round down
                targetInterval = rowTimestamp.clone().subtract(remainder, 'minutes').startOf('minute');
            } else if (remainder >= 13) {
                // Within 2 minutes after a 15-min mark, round up
                targetInterval = rowTimestamp.clone().add(15 - remainder, 'minutes').startOf('minute');
            } else {
                // In middle range (3-12), round to nearest 15-min mark
                if (remainder <= 7) {
                    targetInterval = rowTimestamp.clone().subtract(remainder, 'minutes').startOf('minute');
                } else {
                    targetInterval = rowTimestamp.clone().add(15 - remainder, 'minutes').startOf('minute');
                }
            }
            
            // Only accept if within expected range (not outside our date range)
            const intervalKey = targetInterval.format('YYYY-MM-DD HH:mm:00');
            if (expectedEMSIntervals.includes(intervalKey)) {
                if (!emsExistingDataMap.has(intervalKey)) {
                    emsExistingDataMap.set(intervalKey, new Set());
                }
                emsExistingDataMap.get(intervalKey).add(row.tagId);
            }
        });

        // Step 9: Find missing intervals for regular tags
        const regularMissingMinutes = [];
        let regularMinutesWithCompleteData = 0;

        expectedRegularMinutes.forEach(minute => {
            const existingTags = regularExistingDataMap.get(minute) || new Set();
            const existingTagsCount = existingTags.size;
            const missingTagsCount = regularTagIds.length - existingTagsCount;

            if (missingTagsCount > 0) {
                const missingTagIds = regularTagIds.filter(tagId => !existingTags.has(tagId));
                const isCompletelyMissing = existingTagsCount === 0;

                regularMissingMinutes.push({
                    timestamp: minute,
                    missingTagsCount,
                    totalTags: regularTagIds.length,
                    missingTagIds,
                    isCompletelyMissing
                });
            } else {
                regularMinutesWithCompleteData++;
            }
        });

        // Step 10: Find missing intervals for EMS tags
        const emsMissingIntervals = [];
        let emsIntervalsWithCompleteData = 0;

        expectedEMSIntervals.forEach(interval => {
            const existingTags = emsExistingDataMap.get(interval) || new Set();
            const existingTagsCount = existingTags.size;
            const missingTagsCount = emsTagIds.length - existingTagsCount;

            if (missingTagsCount > 0) {
                const missingTagIds = emsTagIds.filter(tagId => !existingTags.has(tagId));
                const isCompletelyMissing = existingTagsCount === 0;

                emsMissingIntervals.push({
                    timestamp: interval,
                    missingTagsCount,
                    totalTags: emsTagIds.length,
                    missingTagIds,
                    isCompletelyMissing
                });
            } else {
                emsIntervalsWithCompleteData++;
            }
        });

        // Step 11: Calculate summaries
        const regularTotalMinutes = expectedRegularMinutes.length;
        const regularMinutesWithMissingData = regularMissingMinutes.length;
        const regularDataCompleteness = regularTotalMinutes > 0 
            ? parseFloat(((regularMinutesWithCompleteData / regularTotalMinutes) * 100).toFixed(2))
            : 100;

        const emsTotalIntervals = expectedEMSIntervals.length;
        const emsIntervalsWithMissingData = emsMissingIntervals.length;
        const emsDataCompleteness = emsTotalIntervals > 0 
            ? parseFloat(((emsIntervalsWithCompleteData / emsTotalIntervals) * 100).toFixed(2))
            : 100;

        const regularSummary = {
            totalIntervalsExpected: regularTotalMinutes,
            intervalsWithCompleteData: regularMinutesWithCompleteData,
            intervalsWithMissingData: regularMinutesWithMissingData,
            totalTagsMonitored: regularTagIds.length,
            dataCompleteness: regularDataCompleteness,
            intervalType: '1-minute'
        };

        const emsSummary = {
            totalIntervalsExpected: emsTotalIntervals,
            intervalsWithCompleteData: emsIntervalsWithCompleteData,
            intervalsWithMissingData: emsIntervalsWithMissingData,
            totalTagsMonitored: emsTagIds.length,
            dataCompleteness: emsDataCompleteness,
            intervalType: '15-minute'
        };

        const overallSummary = {
            lineId,
            lineName: line.name,
            startDate: start.format('YYYY-MM-DD HH:mm:00'),
            endDate: end.format('YYYY-MM-DD HH:mm:00'),
            totalTagsMonitored: totalTags
        };

        console.log(`📈 Regular tags: ${regularDataCompleteness}% complete (${regularMinutesWithMissingData} minutes with gaps)`);
        console.log(`📈 EMS tags: ${emsDataCompleteness}% complete (${emsIntervalsWithMissingData} intervals with gaps)`);

        return res.status(200).json({
            success: true,
            summary: overallSummary,
            regular: {
                summary: regularSummary,
                missingIntervals: regularMissingMinutes
            },
            ems: {
                summary: emsSummary,
                missingIntervals: emsMissingIntervals
            },
            tagDetails: Array.from(tagDetailsMap.values())
        });

    } catch (error) {
        console.error("❌ [DataGapInspector] Error analyzing data gaps:", error);
        return res.status(500).json({
            error: "Internal server error while analyzing data gaps",
            message: error.message
        });
    }
};

/**
 * Get tag details for a specific line
 * Useful for understanding which tags are being monitored
 * 
 * @route GET /api/data-gap-inspector/line-tags/:lineId
 */
exports.getLineTagDetails = async (req, res) => {
    try {
        const { lineId } = req.params;

        if (!lineId) {
            return res.status(400).json({ error: "lineId is required" });
        }

        // Verify line exists
        const line = await Line.findByPk(lineId);
        if (!line) {
            return res.status(404).json({ error: `Line with ID ${lineId} not found` });
        }

        // Get all tags for this line
        const lineMachines = await LineMachine.findAll({
            where: { lineId },
            include: [
                {
                    model: Machine,
                    as: 'machine',
                    attributes: ['id', 'name'],
                    include: [
                        {
                            model: Tags,
                            as: 'tags',
                            attributes: ['id', 'name', 'ref', 'taggableType', 'unit']
                        }
                    ]
                }
            ]
        });

        // Organize tags by machine
        const machinesWithTags = lineMachines
            .filter(lm => lm.machine && lm.machine.tags && lm.machine.tags.length > 0)
            .map(lm => ({
                machineId: lm.machine.id,
                machineName: lm.machine.name,
                tags: lm.machine.tags.map(tag => ({
                    id: tag.id,
                    name: tag.name,
                    ref: tag.ref,
                    type: tag.taggableType,
                    unit: tag.unit
                }))
            }));

        // Calculate totals
        const totalTags = machinesWithTags.reduce((sum, m) => sum + m.tags.length, 0);

        return res.status(200).json({
            success: true,
            lineId,
            lineName: line.name,
            totalMachines: machinesWithTags.length,
            totalTags,
            machinesWithTags
        });

    } catch (error) {
        console.error("❌ [DataGapInspector] Error fetching line tag details:", error);
        return res.status(500).json({
            error: "Internal server error while fetching line tags",
            message: error.message
        });
    }
};


