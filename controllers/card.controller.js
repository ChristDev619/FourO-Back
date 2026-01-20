const dayjs = require("dayjs");
const logger = require("../utils/logger");
const { generateAlarmJoinCondition, generateAlarmWhereCondition } = require("../utils/alarmUtils");
const {
  Card,
  sequelize,
  Meters,
  Tags,
  TagValues,
  Unit,
  Op,
  TariffUsage,
  Tariff,
  GeneratorMachineMeterTagValues,
  Dashboard,
  Job,
  JobLineMachineTag,
  Alarm,
  AlarmAggregation,
  Machine,
  Line,
  Reason,
  Program,
} = require("../dbInit");

const TagAggregationService = require("../utils/services/TagAggregationService");
const tagAggregationService = new TagAggregationService();

const { jobService , oeeTimeSeriesService} = require("../utils/modules");
const TagRefs = require("../utils/constants/TagRefs");
const STATE_CONFIG = require("../utils/constants/StateConfig");

const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
const moment = require("moment-timezone");
const { QueryTypes } = require("sequelize");
const {
  calculateMetrics,
  getTimeTypeDuration,
  calculateGOT,
  fetchBatchDuration,
  calculateNOT,
  calculateVOT,
} = require("./Kpis.controller");
const { calculateOEETimeSeries } = require("./OEETimeSeries.controller");

module.exports = {
  createCard: async (req, res) => {
    const { title, dashboardId, type, layout } = req.body;
    const transaction = await sequelize.transaction();

    try {
      if (!dashboardId) {
        await transaction.rollback();
        return res.status(400).json({ message: "Dashboard ID is required" });
      }

      // Convert config to string only if it's not already a string
      const config =
        typeof req.body.config === "string"
          ? req.body.config
          : JSON.stringify(req.body.config);

      const [dashboard, card] = await Promise.all([
        Dashboard.findByPk(dashboardId, { transaction }),
        Card.create({ title, dashboardId, type, config }, { transaction }),
      ]);

      if (!dashboard) {
        throw new Error(`Dashboard with ID ${dashboardId} not found`);
      }

      // Parse current layout with safer error handling
      let currentLayout = [];
      if (dashboard.layout) {
        try {
          currentLayout =
            typeof dashboard.layout === "string"
              ? JSON.parse(dashboard.layout)
              : dashboard.layout;
        } catch (err) {
          console.warn(
            `Failed to parse layout for dashboard ${dashboardId}:`,
            err.message
          );
        }
      }

      // Create the new layout item with the card's ID
      const layoutItem = { ...layout[0], i: card.id.toString() };

      // Update the dashboard with the new layout
      await Dashboard.update(
        { layout: [...currentLayout, layoutItem] },
        { where: { id: dashboardId }, transaction }
      );

      await transaction.commit();
      return res.status(201).json(card);
    } catch (error) {
      await transaction.rollback();
      console.error("Error creating card:", error);
      res
        .status(error.name === "SequelizeValidationError" ? 400 : 500)
        .json({ error: error.message });
    }
  },

  getAllCards: async (req, res) => {
    try {
      const cards = await Card.findAll();
      res.status(200).json(cards);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getCardById: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      res.status(200).json(card);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  updateCard: async (req, res) => {
    const { id } = req.params;
    const { title, type, dashboardId, config, cardIndex, counter } = req.body;

    try {
      const card = await Card.findByPk(id);
      if (!card) {
        return res.status(404).send({ message: "Card not found" });
      }
      // Parse existing config from the database
      const existingConfig = card.config ? JSON.parse(card.config) : {};

      //#region this section for now is done for horizontal bar chart
      // Check if offsetLimit exists in the existing config and is not set in incoming config
      if (existingConfig.offsetLimit && (!config || !config.offsetLimit)) {
        if (!config) config = {}; // Ensure config object exists
        config.offsetLimit = existingConfig.offsetLimit; // Reapply existing offsetLimit
      }
      //#endregion

      // Update card with new values
      card.title = title ?? card.title;
      card.type = type ?? card.type;
      card.dashboardId = dashboardId ?? card.dashboardId;
      card.config = JSON.stringify(config); // Use updated config
      card.cardIndex = cardIndex ?? card.cardIndex;
      card.counter = counter ?? card.counter;

      let newCard = await card.save();

      res.status(200).send({ message: "Card updated successfully", newCard });
    } catch (error) {
      res
        .status(500)
        .send({ message: "Failed to update card", error: error.message });
    }
  },

  deleteCard: async (req, res) => {
    const layoutIndex = req.query.index;

    if (
      layoutIndex === undefined ||
      layoutIndex === null ||
      layoutIndex === ""
    ) {
      return res.status(400).json({ message: "Layout index is required." });
    }

    const transaction = await sequelize.transaction();
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        await transaction.rollback();
        return res.status(404).json({ message: "Card not found" });
      }

      await Card.destroy({ where: { id: req.params.id }, transaction });

      const dashboard = await Dashboard.findByPk(card.dashboardId);
      if (dashboard && dashboard.layout) {
        const updatedLayout = dashboard.layout.filter(
          (l) => l.i.toString() !== layoutIndex.toString()
        );
        //  if (updatedLayout && updatedLayout.length != 0) {
        await Dashboard.update(
          { layout: updatedLayout },
          { where: { id: card.dashboardId }, transaction }
        );
        //  }
      }

      await transaction.commit();
      res.status(200).json({ message: "Card deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getCardsByDashboardId: async (req, res) => {
    try {
      const { dashboardId } = req.params;
      const cards = await Card.findAll({
        where: { dashboardId },
      });
      res.status(200).json(cards);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  },

  executeQuery: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const config = JSON.parse(card.config);
      const type = card.type;

      if (!config) {
        return res
          .status(400)
          .json({ message: "Card configuration is missing" });
      }
      if (type === "Single Value" || type === "Gauge") {
        const tagId = config.tagId;

        const lastTagValue = await sequelize.query(
          `SELECT tv.value, u.name as unitName
           FROM TagValues tv
           JOIN Tags t ON tv.tagId = t.id
           JOIN Units u ON t.unitId = u.id
           WHERE tv.tagId = ?
           ORDER BY tv.createdAt DESC
           LIMIT 1`,
          { replacements: [tagId], type: sequelize.QueryTypes.SELECT }
        );

        if (!lastTagValue.length) {
          return res.status(404).json({ message: "Tag value not found" });
        }

        return res.json({
          value: lastTagValue[0].value,
          unit: lastTagValue[0].unitName,
        });
      }
      if (type === "Trend") {
        // Receive endTime from the request parameters or use current time if not provided
        const endTime = req.query.endTime
          ? new Date(req.query.endTime)
          : new Date();
        const startTime = new Date(endTime.getTime() - 2 * 60 * 60 * 1000); // 2 hours before endTime

        const areaChartResults = await sequelize.query(
          `
            SELECT
              DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:00') AS timeGroup,
              AVG(value) AS avgValue
            FROM
              TagValues
            WHERE
              tagId = :tagId
              AND createdAt BETWEEN :startTime AND :endTime
            GROUP BY
              timeGroup
            ORDER BY
              timeGroup;
          `,
          {
            replacements: {
              tagId: config.tagId,
              startTime: startTime.toISOString(), // Format to ISO string for SQL compatibility
              endTime: endTime.toISOString(),
            },
            type: sequelize.QueryTypes.SELECT,
          }
        );

        const formattedData = areaChartResults.map((row) => ({
          time: row.timeGroup,
          value: row.avgValue,
        }));

        return res.json(formattedData);
      }

      const { selectedTags, dateFrom, dateTo } = config;

      let formattedData = [];
      if (selectedTags.length > 0) {
        for (const tag of selectedTags) {
          const results = await sequelize.query(
            `
          SELECT
            DATE(createdAt) AS date,
            MIN(value) AS firstValue,
            MAX(value) AS lastValue
          FROM TagValues
          WHERE tagId = :tagId
            AND createdAt BETWEEN :dateFrom AND :dateTo
          GROUP BY DATE(createdAt)
          ORDER BY DATE(createdAt)
        `,
            {
              replacements: { tagId: tag.id, dateFrom, dateTo },
              type: sequelize.QueryTypes.SELECT,
            }
          );

          // Process the results according to the chart type

          switch (type) {
            case "Data Grid":
              formattedData = formattedData.concat(
                results.map((row, index) => ({
                  id: index + 1,
                  tagName: tag.name,
                  value: row.lastValue - row.firstValue,
                  date: row.date,
                }))
              );
              break;

            case "Line Chart":
              const tagData = results.map((row) => ({
                date: row.date,
                value: row.lastValue - row.firstValue,
              }));

              // Check if tag data already exists in the formatted data
              let tagDataSet = formattedData.find(
                (set) => set.tagName === tag.name
              );
              if (!tagDataSet) {
                formattedData.push({
                  tagName: tag.name,
                  x: tagData.map((data) => data.date),
                  y: tagData.map((data) => data.value),
                });
              } else {
                tagDataSet.x = tagData.map((data) => data.date);
                tagDataSet.y = tagData.map((data) => data.value);
              }
              break;

            case "Bar Chart":

            case "area":
            case "scatter":
              formattedData = formattedData.concat(
                results.map((row) => ({
                  id: formattedData.length + 1,
                  tagName: tag.name,
                  value: row.lastValue - row.firstValue,
                  date: row.date,
                }))
              );
              break;

            case "Pie Chart":
              results.forEach((row) => {
                const value = row.lastValue - row.firstValue;
                if (value > 0) {
                  // Only add positive values to the pie chart
                  formattedData.push([tag.name, value]);
                }
              });
              break;
            // Assuming the structure of your executeQuery function, add this case:
          }
        }
      }

      if (type === "Pie Chart" && formattedData.length > 0) {
        formattedData.unshift(["Task", "Value"]);
      }

      res.json(formattedData);
    } catch (error) {
      console.error("Error executing query:", error);
      res.status(500).json({ message: "Failed to execute query." });
    }
  },

  updateQueryDates: async (req, res) => {
    const { id } = req.params;
    const {
      startDate,
      endDate,
      week,
      year,
      month,
      selectedMeters,
      unit,
      selectedType,
      selectedJobId,
      selectedJobIds,
      selectedMachineId,
      selectedMachineIds,
      minDuration,
      maxDuration,
      selectedLocationId,
      selectedLineId,
    } = req.body;

    try {
      const card = await Card.findByPk(id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      // Ensure the config field is parsed as JSON
      let config = card.config;
      if (typeof config === "string") {
        config = JSON.parse(config);
      }
      if (card.type === "Heatmap Chart") {
        config.week = week;
        config.month = month;
        config.year = year;
        config.selectedMeters = selectedMeters;
        config.unit = unit;
        config.selectedType = selectedType;
        card.config = JSON.stringify(config);
      } else if (card.type === "Stacked Chart") {
        config.week = week;
        config.month = month;
        config.year = year;
        card.config = JSON.stringify(config);
      } else if (
        card.type === "Waterfall Chart" ||
        card.type === "Gantt Chart"
      ) {
        config.startDate = startDate;
        config.endDate = endDate;
        config.selectedJobId = selectedJobId;
        card.config = JSON.stringify(config);
      } else if (card.type === "Gauge" && config.selectedKpi != null) {
        config.startDate = startDate;
        config.endDate = endDate;
        config.selectedJobId = selectedJobId;
        card.config = JSON.stringify(config);
      } else if (card.type === "Data Grid" && config.mode === "Alarms") {
        config.startDate = startDate;
        config.endDate = endDate;
        config.selectedJobIds = selectedJobIds;
        config.selectedMachineIds = selectedMachineIds;
        (config.minDuration = minDuration),
          (config.maxDuration = maxDuration),
          (card.config = JSON.stringify(config));
      } else if (card.type === "SunBurst" && config.mode === "Ems") {
        config.startDate = startDate;
        config.endDate = endDate;
        config.selectedJobId = selectedJobId;
        config.selectedMachineId = selectedMachineId;
        card.config = JSON.stringify(config);
      } else if (card.type === "SunBurst" && config.mode === "Lms") {
        config.startDate = startDate;
        config.endDate = endDate;
        config.selectedJobIds = selectedJobIds;
        config.selectedMachineIds = selectedMachineIds;
        card.config = JSON.stringify(config);
      } else if (card.type === "Horizontal Bar Chart") {
        config.startDate = startDate;
        config.endDate = endDate;
        config.minDuration = minDuration;
        config.maxDuration = maxDuration;

        if (selectedLocationId) config.selectedLocationId = selectedLocationId;

        if (selectedLineId) config.selectedLineId = selectedLineId;

        if (selectedMachineIds?.length) {//christ to check
          config.selectedMachineIds = selectedMachineIds;
        }
        
        card.config = JSON.stringify(config);

      } else {
        config.startDate = startDate;
        config.endDate = endDate;
        card.config = JSON.stringify(config);
      }
      // Update the dates in the card's configuration

      await card.save();

      res
        .status(200)
        .json({ message: "Query dates updated successfully", card });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  executeTariffConfig: async (req, res) => {
    const { selectedGenerators, dateFrom, dateTo } = req.body;

    try {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);

      let resultData = [];

      for (const generator of selectedGenerators) {
        // Fetch meters
        const meters = await Meters.findAll({
          where: {
            generatorId: generator.id,
            machineId: null,
            type: "generator",
          },
        });

        for (const meter of meters) {
          // Fetch tags with unit "kwh"
          const tags = await Tags.findAll({
            where: { taggableId: meter.id },
            include: [
              {
                model: Unit,
                as: "unit", // Specify the alias used in the association
                where: { name: "kwh" },
              },
            ],
          });

          for (const tag of tags) {
            // Fetch first tag value
            const firstTagValue = await TagValues.findOne({
              where: {
                tagId: tag.taggableId,
                createdAt: {
                  [Op.gte]: from,
                  [Op.lt]: new Date(from.getTime() + 24 * 60 * 60 * 1000),
                },
              },
              order: [["createdAt", "ASC"]],
            });

            // Fetch last tag value
            const lastTagValue = await TagValues.findOne({
              where: {
                tagId: tag.taggableId,
                createdAt: {
                  [Op.gte]: to,
                  [Op.lt]: new Date(to.getTime() + 24 * 60 * 60 * 1000),
                },
              },
              order: [["createdAt", "DESC"]],
            });

            if (firstTagValue && lastTagValue) {
              const firstValue = firstTagValue.value;
              const lastValue = lastTagValue.value;
              const consumption = lastValue - firstValue;

              resultData.push({
                generatorName: generator.name,
                meterName: meter.name,
                consumption,
              });
            }
          }
        }
      }

      res.status(200).send(resultData);
    } catch (error) {
      console.log(error);
      res.status(500).send(error);
    }
  },

  executeGaugeQuery: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const config = JSON.parse(card.config);

      if (config.mode === "historical") {
        const startDate = dayjs(config.startDate)
          .startOf("day")
          .format("YYYY-MM-DD HH:mm:ss");
        const endDate = dayjs(config.endDate)
          .endOf("day")
          .format("YYYY-MM-DD HH:mm:ss");
        if (config.selectedKpi == null) {
          // Calculate period difference using MIN/MAX logic (same as old TagDailyAggregates)
          const diffResult = await sequelize.query(`
            SELECT 
              MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
            FROM TagValues 
            WHERE tagId = :tagId 
              AND createdAt BETWEEN :startDate AND :endDate
          `, {
            replacements: { tagId: config.tag.id, startDate, endDate },
            type: sequelize.QueryTypes.SELECT
          });

          const resultValue = diffResult[0]?.diffValue || null;
          if (resultValue !== null) {
            res.json({ value: resultValue });
          } else {
            res
              .status(404)
              .json({ message: "No data available for the selected dates" });
          }
        } else {
          const jobId = await jobService.getJobIdByProgramId(config.selectedJobId);
          if (!jobId) {
            return res.status(404).json({ message: "Job not found for this program" });
          }
          let machineId = config.selectedLine.bottleneckMachine.id;
          let lineId = config.selectedLine.id;
          let value = "";
          // "Performance", "Quality", "OEE"
          switch (config.selectedKpi) {
            case "Availability":
              const batchDuration = await fetchBatchDuration(jobId);
              const got = await calculateGOT(jobId, machineId);
              const availabilty = (got / batchDuration) * 100;
              value = availabilty;
              break;
            case "Performance":
              const not = await calculateNOT(lineId, jobId);
              const per_got = await calculateGOT(jobId, machineId);
              value = (not / per_got) * 100;
              break;
            case "Quality":
              const vot = await calculateVOT(jobId, lineId);
              const qua_Not = await calculateNOT(lineId, jobId);
              value = (vot / qua_Not) * 100;
              break;
            case "OEE":
              const batchDurationOEE = await fetchBatchDuration(jobId);
              const gotOEE = await calculateGOT(jobId, machineId);
              const availabiltyOEE = (gotOEE / batchDurationOEE) * 100;

              const notOEE = await calculateNOT(lineId, jobId);
              // const per_gotOEE = await calculateGOT(jobId, machineId);
              const performanceOEE = (notOEE / gotOEE) * 100;

              const votOEE = await calculateVOT(jobId, lineId);
              // const qua_NotOEE = await calculateNOT(lineId, jobId);
              const qualityOEE = (votOEE / notOEE) * 100;

              value = (availabiltyOEE * performanceOEE * qualityOEE) / 10000;
              break;
            default:
              break;
          }

          if (value) {
            return res.status(200).json({ value: value });
          }
        }
      } else if (config.mode === "live") {
          if (config.selectedKpi == null) {
            // Get latest value directly from TagValues (same as old logic)
            const latestResult = await sequelize.query(`
              SELECT value, createdAt
              FROM TagValues 
              WHERE tagId = :tagId 
              ORDER BY createdAt DESC 
              LIMIT 1
            `, {
              replacements: { tagId: config.tag.id },
              type: sequelize.QueryTypes.SELECT
            });

            if (latestResult.length > 0) {
              res.json({ value: latestResult[0].value });
            } else {
              res.status(404).json({ message: "No live data available" });
            }
        } else {
          const job = await JobLineMachineTag.findOne({
            where: { lineId: config.selectedLine.id },
            order: [["plannedEndTime", "DESC"]], // Ensure the latest job is fetched based on `actualEndTime`
            attributes: ["jobId"], // Only fetch the jobId field
          });

          let jobId = job.jobId;
          let machineId = config.selectedLine.bottleneckMachine.id;
          let lineId = config.selectedLine.id;
          let value = "";
          // "Performance", "Quality", "OEE"

          switch (config.selectedKpi) {
            case "Availability":
              const batchDuration = await fetchBatchDuration(jobId);
              const got = await calculateGOT(jobId, machineId);
              const availabilty = (got / batchDuration) * 100;
              value = availabilty;
              break;
            case "Performance":
              const not = await calculateNOT(lineId, jobId);
              const per_got = await calculateGOT(jobId, machineId);
              value = (not / per_got) * 100;
              break;
            case "Quality":
              const vot = await calculateVOT(jobId, lineId);
              const qua_Not = await calculateNOT(lineId, jobId);
              value = (vot / qua_Not) * 100;
              break;
            case "OEE":
              const batchDurationOEE = await fetchBatchDuration(jobId);
              const gotOEE = await calculateGOT(jobId, machineId);
              const availabiltyOEE = (gotOEE / batchDurationOEE) * 100;

              const notOEE = await calculateNOT(lineId, jobId);
              // const per_gotOEE = await calculateGOT(jobId, machineId);
              const performanceOEE = (notOEE / gotOEE) * 100;

              const votOEE = await calculateVOT(jobId, lineId);
              // const qua_NotOEE = await calculateNOT(lineId, jobId);
              const qualityOEE = (votOEE / notOEE) * 100;

              value = (availabiltyOEE * performanceOEE * qualityOEE) / 10000;
              break;
            default:
              break;
          }

          if (value) {
            return res.status(200).json({ value: value });
          }
        }
      }
    } catch (error) {
      console.error("Error executing gauge query:", error);
      res.status(500).json({ message: "Server error during data retrieval" });
    }
  },

  executeOEETimeSeriesQuery: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
  
      const { selectedJobId, selectedLineId } = JSON.parse(card.config);
  
      // Fetch the latest job for the selected program
      const jobOB = await Job.findOne({
        where: { programId: selectedJobId },
        attributes: ["id"],
        order: [["createdAt", "DESC"]],
        raw: true,
      });
  
      if (!jobOB) {
        return res.status(404).json({ message: "No job found for this program" });
      }
  
      const job = await Job.findByPk(jobOB.id, {
        attributes: ["id", "actualStartTime", "actualEndTime", "jobName"],
        raw: true,
      });
  
      // Fetch OEE curve from DB
      let oeeTimeSeriesData = await oeeTimeSeriesService.getCurve(job.id);
      
      res.status(200).json({
        data: oeeTimeSeriesData,
        job: {
          id: job.id,
          name: job.jobName,
          startTime: job.actualStartTime,
          endTime: job.actualEndTime,
        },
        // ...other metadata if needed
      });
    } catch (error) {
      console.error("Error executing OEE time series query:", error);
      res.status(500).json({ message: "Failed to execute query", error: error.message });
    }
  },

  executeTrend: async (req, res) => {
    const card = await Card.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const config = JSON.parse(card.config);
    const tags = config.selectedTags;

    // Local time two hours ago
    const twoHoursAgoLocal = moment()
      .subtract(2, "hours")
      .format("YYYY-MM-DD HH:mm:ss");

    try {
      const results = await Promise.all(
        tags.map(async (tag) => {
          const query = `
            SELECT * FROM TagValues
            WHERE tagId = :tagId AND createdAt > :twoHoursAgo
            ORDER BY createdAt ASC;
          `;
          return sequelize.query(query, {
            replacements: { tagId: tag.id, twoHoursAgo: twoHoursAgoLocal },
            type: QueryTypes.SELECT,
          });
        })
      );

      const data = tags.map((tag, index) => ({
        id: tag.id,
        x: results[index].map((value) => value.createdAt),
        y: results[index].map((value) => value.value),
        name: `Tag ${tag.name}`,
      }));

      res.status(200).json({ data });
    } catch (error) {
      console.error("Error fetching initial trend data:", error);
      res.status(500).send({ message: "Failed to fetch trend data" });
    }
  },

  OldexecuteBarchartQuery: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      const config = JSON.parse(card.config);
      if (config?.type === "statistical") {
        try {
          // Handle statistical card type
          const { selectedGenerators, unit } = config;

          const dateFrom = dayjs(config.dateFrom)
            .hour(0)
            .minute(0)
            .second(0)
            .millisecond(0)
            .format("YYYY-MM-DD HH:mm:ss");

          const dateTo = dayjs(config.dateTo)
            .hour(23)
            .minute(59)
            .second(59)
            .millisecond(999)
            .format("YYYY-MM-DD HH:mm:ss");
          const tariffUsages = await TariffUsage.findAll({
            where: {
              startDate: {
                [Op.between]: [dateFrom, dateTo],
              },
            },
            include: [{ model: Tariff, as: "tariff" }],
            order: [["endDate", "ASC"]],
          });
          console.error("tariffUsages", tariffUsages);

          const results = [];

          for (const usage of tariffUsages) {
            let totalConsumptionPrice = 0;

            const generatorIds = selectedGenerators.map((gen) => gen.id); // This extracts the IDs from the objects

            const rows = await GeneratorMachineMeterTagValues.findAll({
              where: {
                generator_id: { [Op.in]: generatorIds }, // Pass integer IDs to the query
                meter_type: "generator",
                tag_unit_id: unit.id,
              },
              attributes: [
                "generator_id",
                "generator_name",
                "tariffType",
                "machine_id",
                "machine_name",
                "meter_id",
                "meter_name",
                "meter_type",
                "tag_id",
                "tag_name",
                "tag_unit_id",
              ],
            });

            for (const row of rows) {
              const [firstValue, lastValue] = await Promise.all([
                TagValues.findOne({
                  where: {
                    tagId: row.tag_id,
                    createdAt: { [Op.gte]: usage.startDate },
                  },
                  order: [["createdAt", "ASC"]],
                }),
                TagValues.findOne({
                  where: {
                    tagId: row.tag_id,
                    createdAt: { [Op.lte]: usage.endDate },
                  },
                  order: [["createdAt", "DESC"]],
                }),
              ]);

              if (firstValue && lastValue) {
                const consumption = lastValue.value - firstValue.value;
                const pricePerLiter = usage.tariff.pricePerLiter;
                // row.generator.kwhPerLiter when you add it to the generator
                const kwhPerLiter = 10;
                const pricePerKwh = pricePerLiter / kwhPerLiter;
                totalConsumptionPrice += consumption * pricePerKwh;
              }
            }

            results.push({
              period: `${usage.startDate.toLocaleDateString()} - ${usage.endDate.toLocaleDateString()}`,
              totalConsumptionPrice:
                Math.round(totalConsumptionPrice * 100) / 100,
            });
          }

          res.json({
            data: {
              x: results.map((item) => item.period),
              y: results.map((item) => item.totalConsumptionPrice),
              type: "bar",
            },
          });
        } catch (error) {
          console.error("Error executing bar chart query:", error);
          res.status(500).json({ message: "Failed to execute query." });
        }
      } else {
        const { selectedTags, unit } = config;
        const dateFrom = dayjs(config.dateFrom)
          .hour(0)
          .minute(0)
          .second(0)
          .millisecond(0)
          .format("YYYY-MM-DD HH:mm:ss");
        const dateTo = dayjs(config.dateTo)
          .hour(23)
          .minute(59)
          .second(59)
          .millisecond(59)
          .format("YYYY-MM-DD HH:mm:ss");
        if (!config) {
          return res
            .status(400)
            .json({ message: "Card configuration is missing" });
        }

        // Calculate the day after the dateTo to include the entire day of dateTo
        // const dayAfterDateTo = dayjs(dateTo);
        // dayAfterDateTo.setDate(dayAfterDateTo.getDate() + 1);

        let resultsData = [];

        for (const tag of selectedTags) {
          const meterQuery = await Meters.findByPk(tag.meterId, {
            attributes: ["name"],
          });

          const firstValueQuery = `
                SELECT value, createdAt
                FROM TagValues
                WHERE tagId = :tagId AND createdAt >= :dateFrom
                ORDER BY createdAt ASC
                LIMIT 1;
            `;

          const lastValueQuery = `
                SELECT value, createdAt
                FROM TagValues
                WHERE tagId = :tagId AND createdAt <= :dateTo
                ORDER BY createdAt DESC
                LIMIT 1;
            `;

          const [firstValueResult] = await sequelize.query(firstValueQuery, {
            replacements: { tagId: tag.id, dateFrom: dateFrom },
            type: sequelize.QueryTypes.SELECT,
          });

          const [lastValueResult] = await sequelize.query(lastValueQuery, {
            replacements: {
              tagId: tag.id,
              dateTo: dateTo,
            },
            type: sequelize.QueryTypes.SELECT,
          });

          if (firstValueResult && lastValueResult) {
            const consumption = lastValueResult.value - firstValueResult.value;
            resultsData.push({
              meterName: meterQuery.name,
              tagName: tag.name,
              value: consumption,
              tagId: tag.id,
            });
          }
        }

        res.json({
          data: resultsData.map((d) => ({
            x: d.meterName,
            y: d.value,
            text: d.tagName,
            tagId: d.tagId,
          })),
        });
      }
    } catch (error) {
      console.error("Error executing bar chart query:", error);
      res.status(500).json({ message: "Failed to execute query." });
    }
  },

  executeBarchartQuery: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      const config = JSON.parse(card.config);

      const { selectedMeters, unit, selectedType } = config;

      const selectedMeterIds = selectedMeters.map((meter) => meter.id); // Assuming each meter object has an 'id' field

      const startDate = dayjs(config.startDate)
        .hour(0)
        .minute(0)
        .second(0)
        .millisecond(0)
        .format("YYYY-MM-DD HH:mm:ss");
      const endDate = dayjs(config.endDate)
        .hour(23)
        .minute(59)
        .second(59)
        .millisecond(59)
        .format("YYYY-MM-DD HH:mm:ss");
      let selectedTags;
      if (selectedType && selectedType.name === "consumption") {
        // For receivers, query directly from meters and tags tables
        const receiversQuery = `
          SELECT 
            m.id as meter_id,
            m.name as meter_name,
            m.type as meter_type,
            t.id as tag_id,
            t.name as tag_name,
            t.unitId as tag_unit_id
          FROM meters m
          LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
          WHERE m.type = 'receiver' 
            AND t.unitId = ${unit.id}
            AND m.id IN (${selectedMeterIds.join(',')})
        `;
        
        selectedTags = await sequelize.query(receiversQuery, {
          type: sequelize.QueryTypes.SELECT
        });
      } else {
        // For generators, use the existing view
        selectedTags = await GeneratorMachineMeterTagValues.findAll({
          attributes: [
            [sequelize.fn("max", sequelize.col("meter_id")), "meter_id"],
            [sequelize.fn("max", sequelize.col("meter_name")), "meter_name"],
            [sequelize.fn("max", sequelize.col("meter_type")), "meter_type"],
            [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
            [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
            [sequelize.fn("max", sequelize.col("tag_unit_id")), "tag_unit_id"],
          ],
          where: {
            meter_type: {
              [Op.in]: ["generator"],
            },
            meter_id: {
              [Op.in]: selectedMeterIds, // Filter by meter IDs
            },
            tag_unit_id: {
              [Op.in]: [unit.id], // Filter by unitId
            },
          },
          group: ["meter_id"],
        });
      }
      // const tagIds = selectedTags.map((item) => item.tag_id);

      const results = await Promise.all(
        selectedTags.map(async (tag) => {
          // Calculate period difference using MIN/MAX logic (same as old TagDailyAggregates)
          const diffResult = await sequelize.query(`
            SELECT 
              MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
            FROM TagValues 
            WHERE tagId = :tagId 
              AND createdAt BETWEEN :startDate AND :endDate
          `, {
            replacements: { tagId: tag.tag_id, startDate, endDate },
            type: sequelize.QueryTypes.SELECT
          });

          return {
            tagName: tag.tag_name,
            tagId: tag.tag_id,
            diffValue: parseFloat(diffResult[0]?.diffValue) || 0,
          };
        })
      );
      // return res.json(results);
      // Sort results by diffValue in descending order
      // const sortedResults = results.sort((a, b) => b.diffValue - a.diffValue);

      // Prepare data for Plotly.js bar chart
      const barChartData = {
        x: results.map((result) => ({
          tagName: result.tagName,
          tagId: result.tagId,
        })), // Using tagName for x-axis labels
        y: results.map((result) => result.diffValue),
        type: "bar",
      };

      res.json({
        data: [barChartData],
        layout: {
          title: "Bar Chart of Tag Values",
          xaxis: {
            title: "Tags",
          },
          yaxis: {
            title: "Value Difference",
          },
        },
      });
    } catch (error) {
      console.error("Error fetching bar chart data:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

  executeBarchartDrillDownQuery: async (req, res) => {
    try {
      const { id } = req.params; // tagId
      const { startDate, endDate } = req.query;

      // Calculate daily aggregates directly from TagValues (same as old TagDailyAggregates logic)
      const formattedDateFrom = dayjs(startDate).format("YYYY-MM-DD");
      const formattedDateTo = dayjs(endDate).format("YYYY-MM-DD");
      
      // Use MIN/MAX logic per day (same as old TagDailyAggregates)
      const results = await sequelize.query(`
        SELECT 
          DATE(createdAt) as date,
          MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
        FROM TagValues 
        WHERE tagId = :tagId 
          AND DATE(createdAt) BETWEEN :dateFrom AND :dateTo
        GROUP BY DATE(createdAt)
        ORDER BY date ASC
      `, {
        replacements: { tagId: id, dateFrom: formattedDateFrom, dateTo: formattedDateTo },
        type: sequelize.QueryTypes.SELECT
      });

      const formattedData = results.map((row) => ({
        x: row.date,
        y: row.diffValue,
        text: `${row.date}: ${row.diffValue}`,
      }));

      res.json({ data: formattedData });
    } catch (error) {
      console.error("Error executing bar chart drill down query:", error);
      res.status(500).json({ message: "Failed to execute query." });
    }
  },

  executeStatisticalBarchartQuery: async (req, res) => {
    const card = await Card.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }
    const config = JSON.parse(card.config);

    try {
      // Handle statistical card type
      const {
        selectedGenerators,
        selectedTariffType,
        unit,
        startDate,
        endDate,
        flatRate,
        costPerKwh,
        year,
        month,
        selectedMeters,
      } = config;

      const dateFrom = dayjs(startDate)
        .hour(0)
        .minute(0)
        .second(0)
        .millisecond(0)
        .format("YYYY-MM-DD HH:mm:ss");

      const dateTo = dayjs(endDate)
        .hour(23)
        .minute(59)
        .second(59)
        .millisecond(999)
        .format("YYYY-MM-DD HH:mm:ss");
      const results = [];
      let totalConsumptionPrice = 0;
      if (selectedTariffType.name.includes("Utility")) {
        const startDate = new Date(year, month - 1, 1); // Months are 0-based in JavaScript Date
        const endDate = new Date(year, month, 0); // This trick gets the last day of the previous month, which is the end of the desired month
        let totalUtilityConsumption = 0;
        
        for (const row of selectedMeters) {
          // Calculate period difference using MIN/MAX logic (same as old TagMonthlyAggregates)
          const diffResult = await sequelize.query(`
            SELECT 
              MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
            FROM TagValues 
            WHERE tagId = :tagId 
              AND createdAt BETWEEN :startDate AND :endDate
          `, {
            replacements: { tagId: row.tag_id, startDate, endDate },
            type: sequelize.QueryTypes.SELECT
          });
          
          const resultValue = parseFloat(diffResult[0]?.diffValue) || 0;
          if (resultValue !== null) {
            const consumption = resultValue;
            totalConsumptionPrice += consumption * costPerKwh;
            totalUtilityConsumption += consumption;
          }
        }
        
        results.push({
          period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
          totalConsumptionPrice:
            parseFloat(totalConsumptionPrice) + parseFloat(flatRate),
          totalConsumption: totalUtilityConsumption,
        });
      } else if (selectedTariffType.name.includes("PV")) {
        let rows = selectedMeters;
        let totalConsumption = 0;
        for (const row of rows) {
          // Calculate period difference using MIN/MAX logic (same as old TagDailyAggregates)
          const diffResult = await sequelize.query(`
            SELECT 
              MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
            FROM TagValues 
            WHERE tagId = :tagId 
              AND createdAt BETWEEN :startDate AND :endDate
          `, {
            replacements: { tagId: row.tag_id, startDate: dateFrom, endDate: dateTo },
            type: sequelize.QueryTypes.SELECT
          });
          
          const resultValue = parseFloat(diffResult[0]?.diffValue) || 0;
          if (resultValue !== null) {
            const consumption = resultValue;
            totalConsumptionPrice += consumption * flatRate;
            totalConsumption += consumption;
          }
        }
        results.push({
          period: `${new Date(dateFrom).toLocaleDateString()} - ${new Date(
            dateTo
          ).toLocaleDateString()}`,
          totalConsumptionPrice: totalConsumptionPrice,
          totalConsumption: totalConsumption,
        });
      } else {
        const tariffUsages = await TariffUsage.findAll({
          where: {
            startDate: {
              [Op.between]: [dateFrom, dateTo], // Ensuring startDate falls within the specified range
            },
          },
          include: [
            {
              model: Tariff,
              as: "tariff",
              where: {
                typeId: selectedTariffType.id, // Ensuring the associated Tariff's typeId matches
              },
            },
          ],
          order: [["endDate", "ASC"]],
        });

        for (const usage of tariffUsages) {
          const generatorIds = selectedGenerators.map((gen) => gen.id); // This extracts the IDs from the objects

          const rows = await GeneratorMachineMeterTagValues.findAll({
            where: {
              generator_id: { [Op.in]: generatorIds }, // Pass integer IDs to the query
              meter_type: "generator",
              tag_unit_id: unit.id,
            },
            attributes: [
              "generator_id",
              "generator_name",
              "tariffType",
              "kwhPerLiter",
              "machine_id",
              "machine_name",
              "meter_id",
              "meter_name",
              "meter_type",
              "tag_id",
              "tag_name",
              "tag_unit_id",
            ],
            // group: ["meter_id"],
          });
          let firstValue;
          let lastValue;
          for (const row of rows) {
            // Calculate daily aggregates directly from TagValues (same as old TagDailyAggregates logic)
            const aggregateResult = await sequelize.query(`
              SELECT 
                MIN(CAST(value AS DECIMAL(10,2))) as minValue,
                MAX(CAST(value AS DECIMAL(10,2))) as maxValue
              FROM TagValues 
              WHERE tagId = :tagId 
                AND createdAt BETWEEN :startDate AND :endDate
              ORDER BY createdAt ASC
            `, {
              replacements: { tagId: row.tag_id, startDate: dateFrom, endDate: dateTo },
              type: sequelize.QueryTypes.SELECT
            });

            if (aggregateResult.length > 0 && aggregateResult[0].minValue !== null) {
              firstValue = aggregateResult[0].minValue;
              lastValue = aggregateResult[0].maxValue;
              const resultValue = lastValue - firstValue;
            }

            if (firstValue && lastValue) {
              const consumption = lastValue - firstValue;
              const pricePerLiter = usage.tariff.pricePerLiter;
              // row.generator.kwhPerLiter when you add it to the generator
              const kwhPerLiter = row.kwhPerLiter;
              const pricePerKwh = pricePerLiter / kwhPerLiter;
              console.error("row", row);
              totalConsumptionPrice += consumption * pricePerKwh;
            }
          }

          results.push({
            period: `${usage.startDate.toLocaleDateString()} - ${usage.endDate.toLocaleDateString()}`,
            totalConsumptionPrice:
              Math.round(totalConsumptionPrice * 100) / 100,
            totalConsumption: lastValue - firstValue,
          });
        }
      }

      res.json({
        data: [
          {
            x: results.map((item) => item.period),
            y: results.map((item) => parseFloat(item.totalConsumptionPrice) || 0),
            consumption: results.map((item) => parseFloat(item.totalConsumption) || 0),
            type: "bar",
          },
        ],
      });
    } catch (error) {
      console.error("Error executing bar chart query:", error);
      res.status(500).json({ message: "Failed to execute query." });
    }
  },

  executeBarChartKpis: async (req, res) => {
    try {
      const cardId = req.params.id;

        // Fetch only card ID and config (minimal DB query)
        const card = await Card.findByPk(cardId, {
            attributes: ['config'] // Only fetch config column
        });
        if (!card) return res.status(404).json({ message: "Card not found" });

        const config = JSON.parse(card.config);
        if (!config || config.mode !== "Kpis") {
            return res.status(400).json({ message: "Invalid configuration" });
        }

        // Fetch JUST ONE job ID (most efficient query)
        const job = await Job.findOne({
            where: { programId: config.selectedJobId },
            attributes: ['id'], // Only fetch ID
            order: [['createdAt', 'DESC']], // Get most recent job
            raw: true // Returns plain object (no Sequelize instance)
        });

        if (!job) {
            return res.status(404).json({ message: "No jobs found for this program" });
        }

      // Fetch KPI metrics using the provided IDs
      const metrics = await calculateMetrics(
        job.id,
        config.selectedMachineId,
        config.selectedLineId
      );

      if (!metrics) {
        return res.status(404).json({ message: "Metrics data not found" });
      }

      // Calculate KPIs
      const availability = (metrics.got / metrics.batchDuration) * 100;
      const performance = (metrics.not / metrics.got) * 100;
      const quality = (metrics.vot / metrics.not) * 100;
      const oee = (availability * performance * quality) / 10000;

      // Prepare data for the bar chart
      const responseData = {
        x: ["Availability", "Performance", "Quality", "OEE"],
        y: [
          availability.toFixed(2),
          performance.toFixed(2),
          quality.toFixed(2),
          oee.toFixed(2),
        ],
        type: "bar",
        text: ["Availability", "Performance", "Quality", "OEE"],
      };

      res.status(200).json({ data: [responseData] });
    } catch (error) {
      console.error("Error executing bar chart KPIs query:", error);
      res.status(500).json({ message: "Failed to execute query." });
    }
  },

  executeHeatMapChartQuery: async (req, res) => {
    try {
      const cardId = req.params.id;
      const card = await Card.findByPk(cardId);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      let selectedTags = [];
      const config = JSON.parse(card.config);
      const { selectedMeters, year, month, week, selectedType, unit } = config;
      const selectedMeterIds = selectedMeters.map((meter) => meter.id); // Assuming each meter object has an 'id' field

      if (selectedType.name === "consumption") {
        // For receivers, query directly from meters and tags tables
        const receiversQuery = `
          SELECT 
            m.id as meter_id,
            m.name as meter_name,
            m.type as meter_type,
            t.id as tag_id,
            t.name as tag_name,
            t.unitId as tag_unit_id
          FROM meters m
          LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
          WHERE m.type = 'receiver' 
            AND t.unitId = ${unit.id}
            AND m.id IN (${selectedMeterIds.join(',')})
        `;
        
        selectedTags = await sequelize.query(receiversQuery, {
          type: sequelize.QueryTypes.SELECT
        });
      } else {
        // For generators, use the existing view
        selectedTags = await GeneratorMachineMeterTagValues.findAll({
          attributes: [
            [sequelize.fn("max", sequelize.col("meter_id")), "meter_id"],
            [sequelize.fn("max", sequelize.col("meter_name")), "meter_name"],
            [sequelize.fn("max", sequelize.col("meter_type")), "meter_type"],
            [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
            [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
            [sequelize.fn("max", sequelize.col("tag_unit_id")), "tag_unit_id"],
          ],
          where: {
            meter_type: {
              [Op.in]: ["generator"],
            },
            meter_id: {
              [Op.in]: selectedMeterIds, // Filter by meter IDs
            },
            tag_unit_id: {
              [Op.in]: [unit.id], // Filter by unitId
            },
          },
          group: ["meter_id"],
        });
      }
      const tagIds = selectedTags.map((item) => item.tag_id);
      const { startDate, endDate } = getDateRange(year, month, week);

      // Replicate the old TagHourlyAggregates query structure EXACTLY
      // OLD LOGIC: diffValue = MAX(value) - MIN(value) within each hour
      const results = await sequelize.query(`
        SELECT 
          CONCAT(date, ' ', LPAD(hour, 2, '0')) as hourOfDay,
          SUM(diffValue) as totalDiffValue
        FROM (
          SELECT 
            DATE(createdAt) as date,
            HOUR(createdAt) as hour,
            tagId,
            MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
          FROM TagValues 
          WHERE tagId IN (${tagIds.join(',')})
            AND createdAt BETWEEN :startDate AND :endDate
          GROUP BY tagId, DATE(createdAt), HOUR(createdAt)
        ) as tag_hourly_diffs
        GROUP BY date, hour
        ORDER BY hourOfDay ASC
      `, {
        replacements: {
          startDate: dayjs(startDate).startOf("day").format("YYYY-MM-DD HH:mm:ss"),
          endDate: dayjs(endDate).endOf("day").format("YYYY-MM-DD HH:mm:ss")
        },
        type: sequelize.QueryTypes.SELECT
      });

      const formattedResponse = formatForHeatmap(results);
      return res.json(formattedResponse);
    } catch (error) {
      console.error("Error retrieving heatmap data:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  executeSankeyChartQuery: async (req, res) => {
    const cardId = req.params.id;

    const card = await Card.findByPk(cardId);
    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const config = JSON.parse(card.config);
    const {
      selectedGenerators,
      selectedMeters,
      selectedTags,
      unit,
      startDate: dateFrom,
      endDate: dateTo,
    } = config;
    const unitId = unit.id;
    const startDate = dayjs(dateFrom)
      .hour(0)
      .minute(0)
      .second(0)
      .millisecond(0)
      .format("YYYY-MM-DD HH:mm:ss");
    const endDate = dayjs(dateTo)
      .hour(23)
      .minute(59)
      .second(59)
      .millisecond(999)
      .format("YYYY-MM-DD HH:mm:ss");

    try {
      // For receivers, query directly from meters and tags tables (like other endpoints)
      const receiversQuery = `
        SELECT 
          m.id as meter_id,
          m.name as meter_name,
          m.type as meter_type,
          t.id as tag_id,
          t.name as tag_name,
          t.unitId as tag_unit_id
        FROM meters m
        LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
        WHERE m.type = 'receiver' AND t.unitId = ${unit.id}
      `;
      
      const receivers = await sequelize.query(receiversQuery, {
        type: sequelize.QueryTypes.SELECT
      });

      const generators = await GeneratorMachineMeterTagValues.findAll({
        attributes: [
          [sequelize.fn("max", sequelize.col("generator_id")), "generator_id"],
          [
            sequelize.fn("max", sequelize.col("generator_name")),
            "generator_name",
          ],
          [sequelize.fn("max", sequelize.col("tariffType")), "tariffType"],
          "meter_id",
          [sequelize.fn("max", sequelize.col("meter_name")), "meter_name"],
          [sequelize.fn("max", sequelize.col("meter_type")), "meter_type"],
          [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
          [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
          [sequelize.fn("max", sequelize.col("tag_unit_id")), "tag_unit_id"],
        ],
        where: {
          meter_type: {
            [Op.in]: ["generator"],
          },
          tag_unit_id: {
            [Op.in]: [unit.id],
          },
        },
        group: ["meter_id"],
      });

      // Helper function to calculate the energy value difference
      async function calculateValues(tags, type) {
        return Promise.all(
          tags.map(async (tag) => {
            try {
              // Calculate period difference using last-first logic (correct approach)
              const firstValueQuery = `
                SELECT value, createdAt
                FROM TagValues
                WHERE tagId = :tagId AND createdAt >= :startDate
                ORDER BY createdAt ASC
                LIMIT 1;
              `;

              const lastValueQuery = `
                SELECT value, createdAt
                FROM TagValues
                WHERE tagId = :tagId AND createdAt <= :endDate
                ORDER BY createdAt DESC
                LIMIT 1;
              `;

              const [firstValueResult] = await sequelize.query(firstValueQuery, {
                replacements: { tagId: tag.tag_id, startDate },
                type: sequelize.QueryTypes.SELECT,
              });

              const [lastValueResult] = await sequelize.query(lastValueQuery, {
                replacements: { tagId: tag.tag_id, endDate },
                type: sequelize.QueryTypes.SELECT,
              });

              let safeValue = 0;
              if (firstValueResult && lastValueResult) {
                const firstValue = parseFloat(firstValueResult.value);
                const lastValue = parseFloat(lastValueResult.value);
                safeValue = lastValue - firstValue;
              }

              return type === "generators"
                ? {
                    name: `${tag.generator_name} (${safeValue.toFixed(2)} ${unit.name})`,
                    tariffType: tag.tariffType,
                    value: safeValue,
                  }
                : {
                    name: `${tag.meter_name} (${safeValue.toFixed(2)} ${unit.name})`,
                    value: safeValue,
                  };
            } catch (err) {
              console.error(
                "Error calculating values for tag:",
                tag.tag_id,
                err
              );
              return {
                name: `${tag.generator_name} (error)`,
                tariffType: tag.tariffType,
                value: 0,
              };
            }
          })
        );
      }

      const generatorValues = await calculateValues(generators, "generators");
      const receiverValues = await calculateValues(receivers, "receivers");

      // Initialize nodes and links arrays for Plotly
      const nodes = [];
      const links = [];

      // Map to store indexes of nodes to ensure they are referenced correctly in links
      const nodeIndex = {};

      const addNode = (name) => {
        if (!nodeIndex.hasOwnProperty(name)) {
          nodeIndex[name] = nodes.length;
          nodes.push({ name });
        }
        return nodeIndex[name];
      };

      // Create generator-to-tariff-type-to-receiver flow (keeping the middle section)
      
      // Step 1: Calculate totals by tariff type first
      const totalByTariffType = generatorValues.reduce((acc, generator) => {
        acc[generator.tariffType] = (acc[generator.tariffType] || 0) + generator.value;
        return acc;
      }, {});

      // Step 2: Create tariff type nodes with consistent names
      const tariffTypeNodes = {};
      Object.keys(totalByTariffType).forEach((tariffType) => {
        const tariffTypeTotal = totalByTariffType[tariffType];
        const tariffTypeName = `Tariff Type: ${tariffType} (${tariffTypeTotal.toFixed(2)} ${unit.name})`;
        tariffTypeNodes[tariffType] = tariffTypeName;
        addNode(tariffTypeName); // Pre-create the node to ensure consistency
      });

      // Step 3: Add generator nodes and their links to tariff types
      generatorValues.forEach((generator) => {
        const generatorIndex = addNode(generator.name);
        const tariffTypeIndex = addNode(tariffTypeNodes[generator.tariffType]);
        
        links.push({
          source: generatorIndex,
          target: tariffTypeIndex,
          value: generator.value,
        });
      });

      // Step 4: Calculate total generation and create Phase 3 (Total Generated node)
      const totalGeneration = Object.values(totalByTariffType).reduce((sum, val) => sum + val, 0);
      const totalGeneratedName = `Total Generated (${totalGeneration.toFixed(2)} ${unit.name})`;
      const totalGeneratedIndex = addNode(totalGeneratedName);
      
      // Step 5: Connect tariff types (Phase 2) to Total Generated (Phase 3)
      Object.keys(totalByTariffType).forEach((tariffType) => {
        const tariffTypeTotal = totalByTariffType[tariffType];
        const tariffTypeIndex = addNode(tariffTypeNodes[tariffType]);
        
        // Connect each tariff type to Total Generated with its respective value
        links.push({
          source: tariffTypeIndex,
          target: totalGeneratedIndex,
          value: tariffTypeTotal,
        });
      });
      
      // Step 6: Connect Total Generated (Phase 3) to Receivers (Phase 4) with actual consumption values
      receiverValues.forEach((receiver) => {
        const receiverIndex = addNode(receiver.name);
        // Use actual receiver consumption values (Option A: proportional by actual consumption)
        if (receiver.value > 0.01) {
          links.push({
            source: totalGeneratedIndex,
            target: receiverIndex,
            value: receiver.value,
          });
        }
      });
      
      res.json({
        nodes,
        links,
      });
    } catch (error) {
      console.error("Error generating Sankey chart:", error);
      res.status(500).send("Failed to generate Sankey chart");
    }
  },

  executeLineChartQuery: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const config = JSON.parse(card.config);
      if (!config) {
        return res
          .status(400)
          .json({ message: "Card configuration is missing" });
      }

      let resultsData = [];

      // Handle LMS Mode
      if (config.mode === "Lms") {
        const { selectedTagIds, selectedLineId, selectedJobId } = config;

        if (!selectedTagIds || selectedTagIds.length === 0) {
          return res.status(400).json({ message: "No tags selected" });
        }

        if (!selectedJobId) {
          return res.status(400).json({ message: "No program selected" });
        }

        // Find all jobs under the selected program
        const jobs = await Job.findAll({
          where: { programId: selectedJobId },
          attributes: ["actualStartTime", "actualEndTime"],
        });

          if (!jobs || jobs.length === 0) {
              return res.status(404).json({ message: "No jobs found under this program" });
          }

          // Find the overall range (earliest start, latest end)
          const startDate = dayjs.min(jobs.map(j => dayjs(j.actualStartTime))).utc().format("YYYY-MM-DD HH:mm:ss");
          const endDate = dayjs.max(jobs.map(j => dayjs(j.actualEndTime))).utc().format("YYYY-MM-DD HH:mm:ss");

        // Raw query for LMS to avoid timezone issues
        const query = `
                SELECT 
                    Tags.id AS tagId,
                    Tags.name AS tagName,
                    TagValues.value AS tagValue,
                    TagValues.createdAt
                FROM
                    TagValues
                INNER JOIN
                    Tags ON TagValues.tagId = Tags.id
                WHERE
                    TagValues.tagId IN (:selectedTagIds)
                    AND TagValues.createdAt BETWEEN :startDate AND :endDate
                ORDER BY TagValues.createdAt ASC, Tags.id ASC;
            `;

        const replacements = {
          selectedTagIds,
          startDate,
          endDate,
        };

        const tagValues = await sequelize.query(query, {
          replacements,
          type: sequelize.QueryTypes.SELECT,
        });

        // Group data by tag for the line chart format
        const groupedData = {};
        tagValues.forEach(({ tagId, tagName, tagValue, createdAt }) => {
          if (!groupedData[tagId]) {
            groupedData[tagId] = {
              name: tagName,
              type: "line",
              x: [],
              y: [],
            };
          }
          groupedData[tagId].x.push(
            dayjs.utc(createdAt).format("YYYY-MM-DD HH:mm:ss")
          );
          groupedData[tagId].y.push(tagValue);
        });

        resultsData = Object.values(groupedData);
      } else {
        const startDate = dayjs(config.startDate)
          .startOf("day")
          .format("YYYY-MM-DD");
        const endDate = dayjs(config.endDate).endOf("day").format("YYYY-MM-DD");

        // Default (EMS Mode) - Now supports both generators and receivers like bar chart
        const { selectedTags, selectedMeters, selectedType, unit } = config;
        
        let tagsToProcess = [];
        
        if (selectedType && selectedType.name === "consumption") {
          // For receivers, query directly from meters and tags tables (same as bar chart)
          const selectedMeterIds = selectedMeters.map((meter) => meter.id);
          const receiversQuery = `
            SELECT 
              m.id as meter_id,
              m.name as meter_name,
              m.type as meter_type,
              t.id as tag_id,
              t.name as tag_name,
              t.unitId as tag_unit_id
            FROM meters m
            LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
            WHERE m.type = 'receiver' 
              AND t.unitId = ${unit.id}
              AND m.id IN (${selectedMeterIds.join(',')})
          `;
          
          tagsToProcess = await sequelize.query(receiversQuery, {
            type: sequelize.QueryTypes.SELECT
          });
        } else {
          // For generators, use selectedTags (existing behavior)
          tagsToProcess = selectedTags || [];
        }
        
        for (const tag of tagsToProcess) {
          // Calculate daily aggregates using MIN/MAX logic (same as old TagDailyAggregates)
          const tagId = tag.tag_id || tag.id; // Handle both receiver and generator tag structures
          const tagName = tag.tag_name || tag.name;
          
          // Get daily cumulative values (latest reading each day) - simple approach
          const dailyCumulativeQuery = await sequelize.query(`
            SELECT 
              DATE(tv.createdAt) as date,
              CAST(tv.value AS DECIMAL(10,2)) as cumulativeVal
            FROM TagValues tv
            INNER JOIN (
              SELECT DATE(createdAt) as date, MAX(createdAt) as maxTime
              FROM TagValues 
              WHERE tagId = ${tagId}
                AND DATE(createdAt) BETWEEN '${startDate}' AND '${endDate}'
              GROUP BY DATE(createdAt)
            ) latest ON DATE(tv.createdAt) = latest.date AND tv.createdAt = latest.maxTime
            WHERE tv.tagId = ${tagId}
            ORDER BY date ASC
          `, {
            type: sequelize.QueryTypes.SELECT
          });

          // Calculate sequential differences using cumulative values
          const valuesResult = [];
          for (let i = 0; i < dailyCumulativeQuery.length; i++) {
            const currentDay = dailyCumulativeQuery[i];
            let diffValue;
            
            if (i === 0) {
              // First day: use daily consumption (MAX - MIN for that day)
              const firstDayQuery = await sequelize.query(`
                SELECT 
                  MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as dailyDiff
                FROM TagValues 
                WHERE tagId = ${tagId} AND DATE(createdAt) = '${currentDay.date}'
              `, {
                type: sequelize.QueryTypes.SELECT
              });
              diffValue = parseFloat(firstDayQuery[0].dailyDiff);
            } else {
              // Subsequent days: current cumulative - previous cumulative
              const previousDay = dailyCumulativeQuery[i - 1];
              diffValue = parseFloat(currentDay.cumulativeVal) - parseFloat(previousDay.cumulativeVal);
            }
            
            valuesResult.push({
              date: currentDay.date,
              diffValue: diffValue
            });
          }

          if (valuesResult.length > 0) {
            resultsData.push({
              name: tagName,
              type: "line",
              x: valuesResult.map((point) => point.date),
              y: valuesResult.map((point) => point.diffValue),
            });
          }
        }
      }

      res.json({
        data: resultsData,
      });
    } catch (error) {
      console.error("Error executing line chart query:", error);
      res.status(500).json({ message: "Failed to execute query." });
    }
  },

  executeSunBurstChartQuery: async (req, res) => {
    try {
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      const config = JSON.parse(card.config);

      if (config.mode === "Ems") {
        // Keep existing Ems mode implementation
        try {
          const { selectedMeters, unit, selectedType } = config;

          const selectedMeterIds = selectedMeters.map((meter) => meter.id); // Assuming each meter object has an 'id' field

          const startDate = dayjs(config.startDate)
            .hour(0)
            .minute(0)
            .second(0)
            .millisecond(0)
            .format("YYYY-MM-DD HH:mm:ss");
          const endDate = dayjs(config.endDate)
            .hour(23)
            .minute(59)
            .second(59)
            .millisecond(59)
            .format("YYYY-MM-DD HH:mm:ss");
          let selectedTags;
          
          if (selectedType === "consumption") {
            // For receivers, query directly from meters and tags tables
            const receiversQuery = `
              SELECT 
                m.id as meter_id,
                m.name as meter_name,
                m.type as meter_type,
                t.id as tag_id,
                t.name as tag_name,
                t.unitId as tag_unit_id
              FROM meters m
              LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
              WHERE m.type = 'receiver' 
                AND t.unitId = ${unit.id}
                AND m.id IN (${selectedMeterIds.join(',')})
            `;
            
            selectedTags = await sequelize.query(receiversQuery, {
              type: sequelize.QueryTypes.SELECT
            });
          } else {
            // For generators, use the existing view
            selectedTags = await GeneratorMachineMeterTagValues.findAll({
              attributes: [
                [sequelize.fn("max", sequelize.col("meter_id")), "meter_id"],
                [sequelize.fn("max", sequelize.col("meter_name")), "meter_name"],
                [sequelize.fn("max", sequelize.col("meter_type")), "meter_type"],
                [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
                [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
                [
                  sequelize.fn("max", sequelize.col("tag_unit_id")),
                  "tag_unit_id",
                ],
              ],
              where: {
                meter_type: {
                  [Op.in]: ["generator"],
                },
                meter_id: {
                  [Op.in]: selectedMeterIds, // Filter by meter IDs
                },
                tag_unit_id: {
                  [Op.in]: [unit.id], // Filter by unitId
                },
              },
              group: ["meter_id"],
            });
          }
          // const tagIds = selectedTags.map((item) => item.tag_id);

          const results = await Promise.all(
            selectedTags.map(async (tag) => {
              // Calculate period difference using MIN/MAX logic (same as old TagDailyAggregates)
              const diffResult = await sequelize.query(`
                SELECT 
                  MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
                FROM TagValues 
                WHERE tagId = :tagId 
                  AND createdAt BETWEEN :startDate AND :endDate
              `, {
                replacements: { tagId: tag.tag_id, startDate, endDate },
                type: sequelize.QueryTypes.SELECT
              });

              const diffValue = diffResult[0]?.diffValue || 0;

              return {
                tagName: tag.tag_name, // Use the tag name from selectedTags
                tagId: tag.tag_id,
                diffValue: diffValue,
              };
            })
          );

          // return res.json(results);

          // Sort results by diffValue in descending order
          // const sortedResults = results.sort((a, b) => b.diffValue - a.diffValue);

          // Prepare data for Plotly.js bar chart

          results.sort((a, b) => b.diffValue - a.diffValue);
          const topTen = results.slice(0, 10);
          const others = results.slice(10);
          const othersSum = others.reduce(
            (acc, cur) => (acc ? acc : 0 + cur.diffValue ? cur.diffValue : 0),
            0
          );

          const labels = [
            "Meters",
            ...topTen.map((item) => item.tagName),
            "Others",
            ...others.map((item) => item.tagName),
          ];
          const parents = [
            "",
            ...topTen.map(() => "Meters"),
            "Meters",
            ...others.map(() => "Others"),
          ];
          const values = [
            0,
            ...topTen.map((item) => item.diffValue),
            othersSum,
            ...others.map((item) => (item.diffValue ? item.diffValue : 0)),
          ];

          res.json({
            data: [
              {
                type: "sunburst",
                labels: labels,
                parents: parents,
                values: values,
              },
            ],
            layout: {
              title: "Sunburst Chart of Meter Values",
            },
          });
        } catch (error) {
          console.error("Error fetching chart data:", error);
        }
      } else if (config.mode === "Lms" && config.selectedType === "Alarms") {

        const { selectedMachineIds, selectedJobIds } = config;

          // Get job IDs directly as an array
          const jobIds = (await Job.findAll({
              where: {
                  programId: { [Op.in]: selectedJobIds },
              },
              attributes: ["id"],
              raw: true
          })).map(job => job.id);

        // Query for count - Get ALL alarms by occurrence count
        const alarmCountQuery = `
          WITH AllAlarms AS (
            SELECT 
              AA.alarmCode,
              A.description as alarmDescription,
              COUNT(*) as occurrence_count
            FROM 
              AlarmAggregations AA
              LEFT JOIN Alarms A ON (${generateAlarmJoinCondition('AA', 'A')})
            WHERE 
              AA.jobId IN (:jobIds)
              AND AA.machineId IN (:machineIds)
            GROUP BY 
              AA.alarmCode, A.description
          )
          SELECT 
            alarmCode,
            alarmDescription,
            occurrence_count as total_count
          FROM AllAlarms
          ORDER BY occurrence_count DESC;
        `;

        // Query for duration - Get ALL alarms by total duration
        const alarmDurationQuery = `
          WITH TotalDurations AS (
            SELECT 
              AA.alarmCode,
              A.description as alarmDescription,
              SUM(AA.duration) as total_duration
            FROM 
              AlarmAggregations AA
              LEFT JOIN Alarms A ON (${generateAlarmJoinCondition('AA', 'A')})
            WHERE 
              AA.jobId IN (:jobIds)
              AND AA.machineId IN (:machineIds)
            GROUP BY 
              AA.alarmCode, A.description
          )
          SELECT *
          FROM TotalDurations
          ORDER BY total_duration DESC;
        `;

        const [countResults, durationResults] = await Promise.all([
          sequelize.query(alarmCountQuery, {
            replacements: {
              jobIds: jobIds,
              machineIds: selectedMachineIds,
            },
            type: QueryTypes.SELECT,
          }),
          sequelize.query(alarmDurationQuery, {
            replacements: {
              jobIds: jobIds,
              machineIds: selectedMachineIds,
            },
            type: QueryTypes.SELECT,
          }),
        ]);

        // Process count data
        const top10Count = countResults.slice(0, 10);
        const othersCount = countResults.slice(10);
        const totalCountOthers = othersCount.reduce(
          (sum, item) => sum + parseInt(item.total_count),
          0
        );

        // Process duration data
        const top10Duration = durationResults.slice(0, 10);
        const othersDuration = durationResults.slice(10);
        const totalDurationOthers = othersDuration.reduce(
          (sum, item) => sum + parseFloat(item.total_duration),
          0
        );

        // Prepare sunburst data for both modes
        const countData = {
          type: "sunburst",
          labels: [
            "Count",
            ...top10Count.map(
              (item) => `ALM: ${item.alarmDescription || item.alarmCode}`
            ),
            "Others",
            ...othersCount.map(
              (item) => `ALM: ${item.alarmDescription || item.alarmCode}`
            ),
          ],
          parents: [
            "",
            ...top10Count.map(() => "Count"),
            "Count",
            ...othersCount.map(() => "Others"),
          ],
          values: [
            top10Count.reduce(
              (sum, item) => sum + parseInt(item.total_count),
              0
            ) + totalCountOthers,
            ...top10Count.map((item) => parseInt(item.total_count)),
            totalCountOthers,
            ...othersCount.map((item) => parseInt(item.total_count)),
          ],
          branchvalues: "total",
        };

        const durationData = {
          type: "sunburst",
          labels: [
            "Duration",
            ...top10Duration.map(
              (item) => `ALM: ${item.alarmDescription || item.alarmCode}`
            ),
            "Others",
            ...othersDuration.map(
              (item) => `ALM: ${item.alarmDescription || item.alarmCode}`
            ),
          ],
          parents: [
            "",
            ...top10Duration.map(() => "Duration"),
            "Duration",
            ...othersDuration.map(() => "Others"),
          ],
          values: [
            top10Duration.reduce(
              (sum, item) => sum + parseFloat(item.total_duration),
              0
            ) + totalDurationOthers,
            ...top10Duration.map((item) => parseFloat(item.total_duration)),
            totalDurationOthers,
            ...othersDuration.map((item) => parseFloat(item.total_duration)),
          ],
          branchvalues: "total",
        };

        res.json({
          data: {
            duration: [durationData],
            count: [countData],
          },
        });
      } else if (config.mode === "Lms" && config.selectedType === "State") {
        const { selectedMachineIds, selectedJobIds } = config;

        // Query to get total durations for all states
        const query = `
          SELECT 
            MSA.machineId,
            MSA.machineName,
            MSA.stateCode,
            MSA.stateName,
            SUM(MSA.duration) as total_duration
          FROM 
            MachineStateAggregations MSA
          WHERE 
            MSA.jobId IN (:jobIds)
            AND MSA.machineId IN (:machineIds)
          GROUP BY 
            MSA.machineId,
            MSA.machineName,
            MSA.stateCode,
            MSA.stateName
          ORDER BY 
            total_duration DESC
        `;

        const results = await sequelize.query(query, {
          replacements: {
            jobIds: selectedJobIds,
            machineIds: selectedMachineIds,
          },
          type: QueryTypes.SELECT,
        });

        // Process results into top 10 and others
        let totalDuration = 0;
        results.forEach((result) => {
          totalDuration += parseFloat(result.total_duration);
        });

        // Get top 10 states
        const top10 = results.slice(0, 10);
        const others = results.slice(10);

        // Calculate others total duration
        const othersDuration = others.reduce(
          (sum, state) => sum + parseFloat(state.total_duration),
          0
        );

        // Prepare sunburst data
        const labels = [
          "States",
          ...top10.map((state) => `${state.machineName}: ${state.stateName}`),
          "Others",
          ...others.map((state) => `${state.machineName}: ${state.stateName}`),
        ];

        const parents = [
          "",
          ...top10.map(() => "States"),
          "States",
          ...others.map(() => "Others"),
        ];

        const values = [
          totalDuration,
          ...top10.map((state) => parseFloat(state.total_duration)),
          othersDuration,
          ...others.map((state) => parseFloat(state.total_duration)),
        ];

        const data = [
          {
            type: "sunburst",
            labels: labels,
            parents: parents,
            values: values,
            branchvalues: "total",
          },
        ];

        return res.json({ data });
      }
    } catch (error) {
      console.error("Error executing sunburst chart query:", error);
      res.status(500).json({ message: "Failed to execute query." });
    }
  },

  executeDataGridQuery: async (req, res) => {
    try {
      const cardId = req.params.id;

      // Fetch card to get selected tags
      const card = await Card.findByPk(cardId);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const config = JSON.parse(card.config);

      if (config.mode === "Ems") {
        // Adjust according to your config structure
        const { startDate, endDate, selectedMeters, selectedType, unit } = config;
        let selectedTags = [];
        const selectedMeterIds = selectedMeters.map((meter) => meter.id); // Assuming each meter object has an 'id' field

        if (selectedType?.name === "consumption") {
          // For receivers, query directly from meters and tags tables
          const receiversQuery = `
            SELECT 
              m.id as meter_id,
              m.name as meter_name,
              m.type as meter_type,
              t.id as tag_id,
              t.name as tag_name,
              t.unitId as tag_unit_id,
              NULL as generator_id,
              NULL as generator_name,
              NULL as tariffType
            FROM meters m
            LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
            WHERE m.type = 'receiver' 
              AND t.unitId = ${unit.id}
              AND m.id IN (${selectedMeterIds.join(',')})
          `;
          
          selectedTags = await sequelize.query(receiversQuery, {
            type: sequelize.QueryTypes.SELECT
          });
        } else {
          // For generators, use the existing view
          selectedTags = await GeneratorMachineMeterTagValues.findAll({
            attributes: [
              "meter_id",
              [sequelize.fn("max", sequelize.col("meter_name")), "meter_name"],
              [sequelize.fn("max", sequelize.col("meter_type")), "meter_type"],
              [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
              [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
              [sequelize.fn("max", sequelize.col("tag_unit_id")), "tag_unit_id"],
              [
                sequelize.fn("max", sequelize.col("generator_id")),
                "generator_id",
              ],
              [
                sequelize.fn("max", sequelize.col("generator_name")),
                "generator_name",
              ],
              [sequelize.fn("max", sequelize.col("tariffType")), "tariffType"],
              "meter_id",
            ],
            where: {
              meter_type: {
                [Op.in]: ["generator"],
              },
              meter_id: {
                [Op.in]: selectedMeterIds, // Filter by meter IDs
              },
              tag_unit_id: {
                [Op.in]: [unit.id], // Filter by unitId
              },
            },
            group: ["meter_id"],
          });
        }

        const tagIds = selectedTags.map((tag) => tag.tag_id);
        
        console.log('DataGrid Debug:', {
          selectedType: selectedType,
          selectedMeterIds,
          unitId: unit?.id,
          tagIds,
          selectedTagsCount: selectedTags.length
        });

        // Check if we have any tag IDs
        if (tagIds.length === 0) {
          console.log('No tag IDs found for DataGrid, returning empty array');
          return res.status(200).json([]);
        }
        
        // Calculate daily aggregates using MIN/MAX logic (same as old TagDailyAggregates)
        const results = await sequelize.query(`
          SELECT 
            tagId,
            DATE(createdAt) as date,
            MAX(CAST(value AS DECIMAL(10,2))) - MIN(CAST(value AS DECIMAL(10,2))) as diffValue
          FROM TagValues 
          WHERE tagId IN (:tagIds)
            AND createdAt BETWEEN :startDate AND :endDate
          GROUP BY tagId, DATE(createdAt)
          ORDER BY tagId, date ASC
        `, {
          replacements: {
            tagIds: tagIds,
            startDate: dayjs(startDate).startOf("day").format("YYYY-MM-DD HH:mm:ss"),
            endDate: dayjs(endDate).endOf("day").format("YYYY-MM-DD HH:mm:ss")
          },
          type: sequelize.QueryTypes.SELECT
        });

        console.log('DataGrid Results:', {
          resultsCount: results.length,
          sampleResults: results.slice(0, 3)
        });

        // Prepare data for response
        const responseData = results.map((result) => ({
          date: result.date,
          tagId: result.tagId,
          diffValue: result.diffValue,
        }));

        // Include tag metadata for frontend column mapping
        const tagMetadata = selectedTags.map(tag => ({
          tagId: tag.tag_id,
          tagName: tag.tag_name,
          meterId: tag.meter_id,
          meterName: tag.meter_name
        }));

        return res.status(200).json({
          data: responseData,
          tagMetadata: tagMetadata
        });
      }

      if (config.mode === "Alarms") {
        const { selectedMachineIds, selectedJobIds, startDate, endDate } =
          config;

          try {

          let alarmAggregations;

          // Fetch machine alarms for alarm descriptions
          const machineAlarmsPromises = selectedMachineIds.map((machineId) =>
            Alarm.findAll({
              where: { machineId },
              attributes: ["name", "description", "machineId"],
            })
          );
          const machineAlarms = await Promise.all(machineAlarmsPromises);

          // Create a map for quick alarm description lookup (keyed by machineId + alarmCode)
          const alarmDescriptionMap = {};
          machineAlarms.flat().forEach((alarm) => {
            const key = `${alarm.machineId}_${alarm.name}`;
            alarmDescriptionMap[key] = alarm.description;
          });

          // Query based on whether jobs are selected
          if (selectedJobIds && selectedJobIds.length > 0) {

              // Get job IDs directly as an array
              const jobIds = (await Job.findAll({
                  where: {
                      programId: { [Op.in]: selectedJobIds },
                  },
                  attributes: ["id"],
                  raw: true
              })).map(job => job.id);

            // Get alarms for specific jobs and machines
            alarmAggregations = await AlarmAggregation.findAll({
              where: {
                jobId: { [Op.in]: jobIds },
                machineId: { [Op.in]: selectedMachineIds },
              },
              order: [["alarmStartDateTime", "ASC"]],
              include: [
                {
                  model: Machine,
                  as: "machine",
                  attributes: ["id", "name"],
                },
                {
                  model: Line,
                  as: "line",
                  attributes: ["id", "name"],
                },
                {
                  model: Reason,
                  as: "reason",
                  attributes: ["id", "name"],
                  required: false,
                },
              ],
            });
          } else {
            // Get alarms for date range and machines
            alarmAggregations = await AlarmAggregation.findAll({
              where: {
                machineId: { [Op.in]: selectedMachineIds },
                alarmStartDateTime: { [Op.between]: [startDate, endDate] },
                alarmEndDateTime: { [Op.between]: [startDate, endDate] },
              },
              order: [["alarmStartDateTime", "ASC"]],
              include: [
                {
                  model: Machine,
                  as: "machine",
                  attributes: ["id", "name"],
                },
                {
                  model: Line,
                  as: "line",
                  attributes: ["id", "name"],
                },
                {
                  model: Reason,
                  as: "reason",
                  attributes: ["id", "name"],
                  required: false,
                },
              ],
            });
          }

                    const programIds = selectedJobIds || [];
              let jobsProg = [];
              if (programIds.length > 0) {
                jobsProg = await jobService.findJobsByProgramIds(programIds, {
                  attributes: ["id", "jobName"],
                  order: [["createdAt", "DESC"]],
                  raw: true,
                });
              }
              const jobMap = {};
              jobsProg.forEach((job) => {
                jobMap[job.id] = job.jobName;
              });

          // Format the response data
          const formattedAggregations = alarmAggregations.map((agg) => ({
            id: agg.id,
            machineName: agg.machineName,
            lineName: agg.lineName,
            jobName: jobMap[agg.jobId] || "N/A",
            alarmDescription:
              alarmDescriptionMap[`${agg.machineId}_${agg.alarmCode}`] || `Alarm# ${agg.alarmCode}`,
            alarmCode: agg.alarmCode,
            startDateTime: dayjs(agg.alarmStartDateTime).format(
              "YYYY-MM-DD HH:mm"
            ),
            endDateTime: dayjs(agg.alarmEndDateTime).format("YYYY-MM-DD HH:mm"),
            duration: agg.duration,
            reason: agg.reason ? agg.reason.name : null,
            alarmNote: agg.alarmNote,
          }));

          return res.json(formattedAggregations);
        } catch (error) {
          console.error("Error fetching alarm aggregations:", error);
          return res.status(500).json({ message: "Error fetching alarm data" });
        }
      }

      if (config.mode === "Lms") {
        const { selectedTagIds, selectedJobId } = config;

        if (!selectedTagIds || selectedTagIds.length === 0) {
          return res.status(400).json({ message: "No tags selected" });
        }

        if (!selectedJobId) {
          return res.status(400).json({ message: "No program selected" });
        }

          const jobs = await jobService.findJobsByProgramIds([selectedJobId], {
            attributes: ["actualStartTime", "actualEndTime"],
            order: [["actualStartTime", "ASC"]],
            raw: true,
          });
          if (!jobs || jobs.length === 0) {
              return res.status(404).json({ message: "No jobs found under this program" });
          }

          // Find the overall range (earliest start, latest end)
          const startDate = dayjs.min(jobs.map(j => dayjs(j.actualStartTime))).utc().format("YYYY-MM-DD HH:mm:ss");
          const endDate = dayjs.max(jobs.map(j => dayjs(j.actualEndTime))).utc().format("YYYY-MM-DD HH:mm:ss");

        // Find all tags within the selected job
        const query = `
                          SELECT 
                            Tags.id AS tagId,
                            Tags.name AS tagName,
                            TagValues.value AS tagValue,
                            TagValues.createdAt
                          FROM
                            TagValues
                            INNER JOIN Tags ON TagValues.tagId = Tags.id
                          WHERE
                            TagValues.tagId IN (:selectedTagIds)
                            AND TagValues.createdAt BETWEEN :startDate AND :endDate
                          ORDER BY createdAt ASC, tagId ASC;
                        `;
                        //LIMIT 10000;

        const replacements = {
          selectedTagIds,
          startDate,
          endDate,
        };

        const tagValues = await sequelize.query(query, {
          replacements,
          type: sequelize.QueryTypes.SELECT,
        });

        return res.status(200).json(tagValues);
        }

    } catch (error) {
      console.error("Error fetching data:", error);
      return res.status(500).json({ message: "Failed to fetch data." });
    }
  },

  executeStackedBarChartQuery: async (req, res) => {
    const cardId = req.params.id;

    const card = await Card.findByPk(cardId);
    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const config = JSON.parse(card.config);
    const { year, month, week, selectedMeters, selectedType, unit } = config;

    const selectedMeterIds = selectedMeters.map((meter) => meter.id);

    try {
      const { startDate, endDate } = getMonthDateRange(year, month, week);

      // First, get the tag IDs based on the selected type
      let selectedTags;
      if (selectedType && selectedType.name === "consumption") {
        // For receivers, query directly from meters and tags tables
        const receiversQuery = `
          SELECT 
            t.id as tag_id,
            t.name as tag_name
          FROM meters m
          LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
          WHERE m.type = 'receiver' 
            AND t.unitId = ${unit.id}
            AND m.id IN (${selectedMeterIds.join(',')})
        `;
        
        selectedTags = await sequelize.query(receiversQuery, {
          type: sequelize.QueryTypes.SELECT
        });
      } else {
        // For generators, use the existing view
        selectedTags = await GeneratorMachineMeterTagValues.findAll({
          attributes: [
            [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
            [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
          ],
          where: {
            meter_type: {
              [Op.in]: ["generator"],
            },
            meter_id: {
              [Op.in]: selectedMeterIds,
            },
            tag_unit_id: {
              [Op.in]: [unit.id],
            },
          },
          group: ["tag_id"],
        });
      }

      const tagIds = selectedTags.map(tag => tag.tag_id);

      console.log('Stacked Bar Chart Debug:', {
        selectedType: selectedType?.name,
        selectedMeterIds,
        unitId: unit?.id,
        tagIds,
        selectedTagsCount: selectedTags.length
      });

      if (tagIds.length === 0) {
        console.log('No tag IDs found, returning empty data structure');
        return res.json({
          status: "success",
          data: {
            days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            data: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => ({ day, values: [] }))
          }
        });
      }

      const results = await sequelize.query(
        `
          SELECT 
            weekday,
            t.tagId,
            t.tagName,
            SUM(t.totalConsumption) AS totalConsumption
          FROM 
          (
            SELECT 
              DAYNAME(DATE(tv.createdAt)) AS weekday,
              tv.tagId,
              b.name AS tagName,
              MAX(CAST(tv.value AS DECIMAL(10,2))) - MIN(CAST(tv.value AS DECIMAL(10,2))) AS totalConsumption
            FROM 
              TagValues tv
              JOIN Tags b ON tv.tagId = b.id
            WHERE
              DATE(tv.createdAt) BETWEEN :startDate AND :endDate
              AND tv.tagId IN (:tagIds)
            GROUP BY tv.tagId, DATE(tv.createdAt), DAYNAME(DATE(tv.createdAt)), b.name
          ) AS t
          GROUP BY 
            weekday, t.tagId, t.tagName
          ORDER BY 
            FIELD(weekday, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), t.tagId
        `,
        {
          replacements: {
            startDate: dayjs(startDate).startOf("day").format("YYYY-MM-DD"),
            endDate: dayjs(endDate).endOf("day").format("YYYY-MM-DD"),
            tagIds: tagIds,
          },
          type: QueryTypes.SELECT,
        }
      );
      //  return res.json(results);

      // Initialize the data structure properly
      const daysOfWeek = [
        "Monday",
        "Tuesday", 
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ];

      const formattedData = {
        days: daysOfWeek,
        data: daysOfWeek.map(day => ({ day, values: [] }))
      };

      // Group results by weekday
      results.forEach((curr) => {
        const dayIndex = daysOfWeek.indexOf(curr.weekday);
        if (dayIndex !== -1) {
          formattedData.data[dayIndex].values.push({
            tagId: curr.tagId,
            tagName: curr.tagName,
            totalConsumption: parseFloat(curr.totalConsumption) || 0,
          });
        }
      });

      console.log('Stacked Bar Chart Results:', {
        resultsCount: results.length,
        formattedData: JSON.stringify(formattedData, null, 2)
      });

      res.json({ status: "success", data: formattedData });
    } catch (error) {
      console.error("Error generating stacked bar chart data:", error);
      res
        .status(500)
        .json({ message: "Failed to execute query", error: error.message });
    }
  },

executeGanttChartQuery: async (req, res) => {
  try {
    const NO_DATA_LABEL = "No Data";
    const NO_DATA_COLOR = "#b0b0b0";
    
    const card = await Card.findByPk(req.params.id);
    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    const config = JSON.parse(card.config);
    if (!config.selectedJobId) {
      return res.status(400).json({ message: "No program selected" });
    }

    const job = await jobService.findJobByProgramId(config.selectedJobId, {
      attributes: ["id", "actualStartTime", "actualEndTime"],
      raw: false,
    });

    if (!job) {
      return res.status(404).json({ message: "No job found for selected program" });
    }

    // Check if OEE curve should be included and handle curve calculation
    let oeeCurveStatus = null;
    if (config.includeOEECurve) {
      try {
        // Check if OEE curve already exists
        const existingCurve = await oeeTimeSeriesService.getCurve(job.id);
        
        if (!existingCurve || existingCurve.length === 0) {
          // No curve exists, trigger recalculation via worker queue
          console.log(`No OEE curve found for job ${job.id}, triggering recalculation via worker...`);
          
          try {
            // Use the same queue system as production run updates
            const recalculationQueue = require("../utils/queues/recalculationQueue");
            await recalculationQueue.add({ jobId: job.id });
            
            oeeCurveStatus = {
              calculated: false,
              message: "OEE curve calculation queued - will be available after worker processes the job",
              queued: true,
              firstTime: true
            };
          } catch (queueError) {
            console.error(`Failed to queue OEE calculation for job ${job.id}:`, queueError);
            oeeCurveStatus = {
              calculated: false,
              message: "Failed to queue OEE curve calculation",
              error: queueError.message,
              firstTime: true
            };
          }
        } else {
          // Curve already exists
          oeeCurveStatus = {
            calculated: true,
            message: "OEE curve already exists",
            firstTime: false,
            dataPoints: existingCurve.length
          };
        }
      } catch (error) {
        console.error(`Error checking OEE curve for job ${job.id}:`, error);
        oeeCurveStatus = {
          calculated: false,
          message: "Error checking OEE curve",
          error: error.message,
          firstTime: null
        };
      }
    }

    // STEP 1: Create a verification mapping of tags to machines
    const tagMachineMapping = {};
    const machineVerification = {};

    for (const machineId of config.selectedMachineIds) {
      // Get machine info
      const machine = await Machine.findByPk(machineId, {
        attributes: ["id", "name"],
      });

      if (!machine) {
        continue;
      }

      // Get ALL tags for this machine to verify the relationship
      const allTagsForMachine = await Tags.findAll({
        where: {
          taggableId: machineId,
          taggableType: "machine",
        },
        attributes: ["id", "name", "ref", "taggableId"],
      });

      // Store verification data
      machineVerification[machineId] = {
        machineName: machine.name,
        tagCount: allTagsForMachine.length,
        tags: allTagsForMachine.map(tag => ({
          id: tag.id,
          name: tag.name,
          ref: tag.ref
        }))
      };

      // Map each tag to its verified machine
      allTagsForMachine.forEach(tag => {
        tagMachineMapping[tag.id] = {
          machineId: machineId,
          machineName: machine.name,
          tagName: tag.name,
          tagRef: tag.ref,
          verified: tag.taggableId === machineId // Double-check the relationship
        };
      });
    }


    const timelineData = [];

    // STEP 3: Process tags with verified mapping
    for (const machineId of config.selectedMachineIds) {
      // Get the primary machine state tag for this machine
      const tag = await Tags.findOne({
        where: {
          taggableId: machineId,
          taggableType: "machine",
          ref: TagRefs.MACHINE_STATE,
        },
        order: [["id", "ASC"]],
      });

      if (!tag) {
        continue;
      }

      // VERIFICATION: Check if this tag is correctly mapped
      const mapping = tagMachineMapping[tag.id];

      // Use verified machine name or fallback to tag name
      const displayName = mapping && mapping.verified ? mapping.machineName : tag.name;

      const tagValues = await TagValues.findAll({
        where: {
          tagId: tag.id,
          createdAt: {
            [Op.between]: [job.actualStartTime, job.actualEndTime],
          },
        },
        order: [["createdAt", "ASC"]],
      });

      // Convert all dates to UTC ISO strings with "000" milliseconds
      const jobStartUTC = formatTimestampWithZeroMs(job.actualStartTime);
      const jobEndUTC = formatTimestampWithZeroMs(job.actualEndTime);

      if (tagValues.length === 0) {
        timelineData.push([
          displayName,
          NO_DATA_LABEL,
          NO_DATA_COLOR,
          jobStartUTC,
          jobEndUTC,
          { 
            tagId: tag.id, 
            machineId: machineId, 
            machineName: mapping?.machineName || 'Unknown',
            tagName: tag.name,
            verified: mapping?.verified || false
          },
        ]);
        continue;
      }

      // Fill at the start if first tag value starts after job start
      if (new Date(tagValues[0].createdAt) > new Date(job.actualStartTime)) {
        timelineData.push([
          displayName,
          NO_DATA_LABEL,
          NO_DATA_COLOR,
          jobStartUTC,
          formatTimestampWithZeroMs(tagValues[0].createdAt),
          { 
            tagId: tag.id, 
            machineId: machineId, 
            machineName: mapping?.machineName || 'Unknown',
            tagName: tag.name,
            verified: mapping?.verified || false
          },
        ]);
      }

      let previousValue = tagValues[0].value;
      let startTime = tagValues[0].createdAt;

      for (let i = 1; i < tagValues.length; i++) {
        const currentValue = tagValues[i].value;
        const currentTime = tagValues[i].createdAt;

        if (currentValue !== previousValue) {
          // End the previous state 1ms before the next state starts to eliminate gaps
          const endTime = dayjs(currentTime).subtract(1, 'millisecond');
          
          timelineData.push([
            displayName,
            getStateLabel(previousValue),
            getStateColor(previousValue),
            formatTimestampWithZeroMs(startTime),
            formatTimestampWithZeroMs(endTime),
            { 
              tagId: tag.id, 
              machineId: machineId, 
              machineName: mapping?.machineName || 'Unknown',
              tagName: tag.name,
              verified: mapping?.verified || false
            },
          ]);

          previousValue = currentValue;
          startTime = currentTime;
        }
      }

      // Push last segment
      const lastEndTime = dayjs(tagValues[tagValues.length - 1].createdAt);
      const jobEndTime = dayjs(job.actualEndTime);
      
      // Push the last state segment
      timelineData.push([
        displayName,
        getStateLabel(previousValue),
        getStateColor(previousValue),
        formatTimestampWithZeroMs(startTime),
        formatTimestampWithZeroMs(lastEndTime),
        { 
          tagId: tag.id, 
          machineId: machineId, 
          machineName: mapping?.machineName || 'Unknown',
          tagName: tag.name,
          verified: mapping?.verified || false
        },
      ]);

      // Fill at the end if last tag value ends before job end
      if (lastEndTime.isBefore(jobEndTime)) {
        timelineData.push([
          displayName,
          NO_DATA_LABEL,
          NO_DATA_COLOR,
          formatTimestampWithZeroMs(lastEndTime),
          formatTimestampWithZeroMs(jobEndTime),
          { 
            tagId: tag.id, 
            machineId: machineId, 
            machineName: mapping?.machineName || 'Unknown',
            tagName: tag.name,
            verified: mapping?.verified || false
          },
        ]);
      }

      // End gap handling is now done above with "No Data" segments
    }

    // STEP 4: Return results with verification metadata and OEE curve status
    const response = {
      data: [
        [
          { type: "string", id: "Machine" },
          { type: "string", id: "Status" },
          { type: "string", role: "style" },
          { type: "date", id: "Start" },
          { type: "date", id: "End" },
        ],
        ...timelineData,
      ],
      job: {
        actualStartTime: formatTimestampWithZeroMs(job.actualStartTime),
        actualEndTime: formatTimestampWithZeroMs(job.actualEndTime),
      },
      // Include verification data in response for debugging
      verification: {
        machineVerification,
        tagMachineMapping,
        totalMachines: Object.keys(machineVerification).length,
        totalTags: Object.keys(tagMachineMapping).length,
      }
    };

    // Add OEE curve status if relevant
    if (oeeCurveStatus) {
      response.oeeCurve = oeeCurveStatus;
    }

    res.json(response);
  } catch (error) {
    console.error("Error executing Gantt Chart query:", error);
    res.status(500).json({ message: "Server error during data retrieval" });
  }
},

// Live Gantt Chart endpoint for real-time machine state updates
executeLiveGanttChartQuery: async (req, res) => {
  try {
    console.log('=== Live Gantt Chart Query Started ===');
    console.log('Card ID:', req.params.id);
    
    const NO_DATA_LABEL = "No Data";
    const NO_DATA_COLOR = "#b0b0b0";
    
    const card = await Card.findByPk(req.params.id);
    if (!card) {
      console.log('ERROR: Card not found');
      return res.status(404).json({ message: "Card not found" });
    }

    const config = JSON.parse(card.config);
    console.log('Config:', { 
      lineId: config.selectedLineId, 
      machineCount: config.selectedMachineIds?.length 
    });
    
    // For live mode, we need selectedLineId and selectedMachineIds
    if (!config.selectedLineId || !config.selectedMachineIds || config.selectedMachineIds.length === 0) {
      return res.status(400).json({ message: "No line or machines selected for live mode" });
    }

    // Get current job for the selected line (most recent active job)
    const currentJob = await Job.findOne({
      where: {
        lineId: config.selectedLineId,
        actualStartTime: { [Op.not]: null },
        actualEndTime: null // Active job (not finished)
      },
      order: [['actualStartTime', 'DESC']],
      attributes: ["id", "actualStartTime", "actualEndTime", "programId"],
      raw: false,
    });

    if (!currentJob) {
      console.log('WARNING: No active job found for lineId:', config.selectedLineId);
      return res.status(404).json({ 
        message: "No active job found for the selected line",
        data: [],
        job: null
      });
    }
    
    console.log('Active Job:', { 
      id: currentJob.id, 
      startTime: currentJob.actualStartTime,
      programId: currentJob.programId 
    });

    // Get current time from database to match the timezone of stored timestamps
    // Note: MySQL NOW() returns time in the database's timezone
    const dbNowResult = await sequelize.query('SELECT NOW() as now, NOW() as oneHourAgo', { 
      type: sequelize.QueryTypes.SELECT 
    });
    const now = new Date(dbNowResult[0].now);
    const oneHourAgo = new Date(new Date(dbNowResult[0].oneHourAgo).getTime() - 60 * 60 * 1000);
    
    console.log('Live Gantt - Database NOW():', {
      now: now.toISOString(),
      oneHourAgo: oneHourAgo.toISOString()
    });

    // Filter machines to exclude labeller
    const filteredMachineIds = config.selectedMachineIds.filter(async (machineId) => {
      const machine = await Machine.findByPk(machineId, {
        attributes: ["id", "name"],
        raw: true
      });
      return machine && !machine.name.toLowerCase().includes('labeller');
    });

    // Get machine state tags for the filtered machines
    const machineStateTags = await Tags.findAll({
      where: {
        taggableId: { [Op.in]: filteredMachineIds },
        taggableType: "machine",
        name: { [Op.like]: "%State%" } // Machine state tags
      },
      attributes: ["id", "name", "ref", "taggableId"],
      raw: true
    });

    console.log('Machine State Tags found:', machineStateTags.length);
    
    if (machineStateTags.length === 0) {
      console.log('ERROR: No machine state tags found for machines:', filteredMachineIds);
      return res.status(404).json({ 
        message: "No machine state tags found for selected machines",
        data: [],
        job: currentJob
      });
    }

    // Get tag values for the last hour
    // Use database's NOW() to avoid timezone issues between server and database
    const tagValues = await TagValues.findAll({
      where: {
        tagId: { [Op.in]: machineStateTags.map(tag => tag.id) },
        createdAt: {
          [Op.gte]: sequelize.literal('DATE_SUB(NOW(), INTERVAL 1 HOUR)')
        }
      },
      order: [['createdAt', 'ASC']],
      attributes: ["id", "tagId", "value", "createdAt"],
      raw: true
    });
    
    console.log(`Live Gantt - Found ${tagValues.length} tag values in last hour`);
    
    // Get the latest timestamp from the tag values to use as "now" for chart rendering
    // This ensures consistency since all timestamps come from the same timezone (database local time)
    const latestTimestamp = tagValues.length > 0 
      ? new Date(Math.max(...tagValues.map(tv => new Date(tv.createdAt).getTime())))
      : now;
    
    console.log('Live Gantt - Latest data timestamp:', latestTimestamp.toISOString());

    // Get machine names for mapping
    const machines = await Machine.findAll({
      where: { id: { [Op.in]: filteredMachineIds } },
      attributes: ["id", "name"],
      raw: true
    });

    const machineMap = {};
    machines.forEach(machine => {
      machineMap[machine.id] = machine.name;
    });

    // Transform data for Gantt chart
    const chartData = [];
    const tagMap = {};
    machineStateTags.forEach(tag => {
      tagMap[tag.id] = {
        machineId: tag.taggableId,
        machineName: machineMap[tag.taggableId] || `Machine ${tag.taggableId}`,
        tagName: tag.name
      };
    });

    // Group tag values by machine and create timeline segments
    const machineSegments = {};
    
    tagValues.forEach(tagValue => {
      const tagInfo = tagMap[tagValue.tagId];
      if (!tagInfo) return;

      const machineId = tagInfo.machineId;
      if (!machineSegments[machineId]) {
        machineSegments[machineId] = {
          machineName: tagInfo.machineName,
          segments: []
        };
      }

      machineSegments[machineId].segments.push({
        value: tagValue.value,
        timestamp: tagValue.createdAt
      });
    });

    // Create Gantt chart data structure
    chartData.push([
      { type: "string", id: "Role" },
      { type: "string", id: "State" },
      { type: "string", id: "style", role: "style" },
      { type: "date", id: "Start" },
      { type: "date", id: "End" },
    ]);

    // Process each machine's segments
    Object.values(machineSegments).forEach(machine => {
      const segments = machine.segments.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      for (let i = 0; i < segments.length; i++) {
        const currentSegment = segments[i];
        const nextSegment = segments[i + 1];
        
        const startTime = new Date(currentSegment.timestamp);
        // For the last segment, use the latest timestamp from the data
        // This ensures all timestamps are in the same timezone
        const endTime = nextSegment ? new Date(nextSegment.timestamp) : latestTimestamp;
        
        // Get state label and color using existing STATE_CONFIG utility
        const stateLabel = getStateLabel(currentSegment.value);
        const stateColor = getStateColor(currentSegment.value);
        
        // Debug logging for last segment of each machine
        if (!nextSegment) {
          console.log(`Live Gantt - ${machine.machineName} last segment:`, {
            value: currentSegment.value,
            stateLabel,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            duration: ((endTime - startTime) / 1000).toFixed(1) + 's'
          });
        }
        
        chartData.push([
          machine.machineName,
          stateLabel,
          `color: ${stateColor}`,
          startTime,
          endTime
        ]);
      }
    });

    const response = {
      data: chartData,
      job: {
        id: currentJob.id,
        actualStartTime: currentJob.actualStartTime,
        actualEndTime: currentJob.actualEndTime,
        programId: currentJob.programId
      },
      timeRange: {
        start: oneHourAgo,
        end: latestTimestamp
      },
      machines: machines.map(m => ({
        id: m.id,
        name: m.name
      }))
    };

    console.log('Live Gantt Response:', {
      chartRows: chartData.length - 1, // Exclude header row
      machineCount: machines.length,
      timeRange: response.timeRange
    });
    console.log('=== Live Gantt Chart Query Completed ===\n');

    res.json(response);
  } catch (error) {
    console.error("Error executing Live Gantt Chart query:", error);
    res.status(500).json({ message: "Server error during live data retrieval" });
  }
},

 executeWaterfallChartQuery: async (req, res) => {
    try {
      // Fetch the card configuration
      const card = await Card.findByPk(req.params.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const config = JSON.parse(card.config);
      const selectedJobId = config.selectedJobId;

      if (!selectedJobId) {
        return res.status(400).json({ message: "No program selected" });
      }

      // 1. Fetch Job with Program included
      const jobs = await Job.findAll({
        where: { programId: selectedJobId },
        include: [
          {
            model: Program,
            as: "program",
          },
        ],
        attributes: [
          "id",
          "actualStartTime",
          "actualEndTime",
          "plannedStartTime",
          "plannedEndTime",
          "plannedProduction",
          "actualProduction",
          "programId",
        ],
      });

      const job = jobs[0];
      const jobId = job.id;
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      //const plannedDuration = dayjs(job.plannedEndTime).diff(dayjs(job.plannedStartTime), "minute");
      const programStart = dayjs(job.program?.startDate);
      const programEnd = dayjs(job.program?.endDate);
      const jobStart = dayjs(job.actualStartTime);
      const jobEnd = dayjs(job.actualEndTime);

      const programDuration = programEnd.diff(programStart, "minute");
      const startUpTime = jobStart.diff(programStart, "minute");
      const runDownTime = programEnd.diff(jobEnd, "minute");
      const metrics = await calculateMetrics(
        jobId,
        config.machineId,
        config.selectedLineId
      );

      const waterfallData = [
        { label: "Operating Working Time", value: programDuration },
        { label: "Start Up Time", value: -startUpTime },
        { label: "Run Down Time", value: -runDownTime },
        { label: "Production Time", value: jobEnd.diff(jobStart, "minute") },
        { label: "Breakdown Time", value: -metrics.udt },
        { label: "Gross Operating Time", value: metrics.got },
        { label: "Speed Loss", value: -metrics.slt },
        { label: "Net Operating Time", value: metrics.not },
        { label: "Quality Loss", value: -metrics.ql },
        { label: "Valuable Operating Time", value: metrics.vot },
      ];
      // Prepare response format
      const responseData = {
        data: {
          labels: waterfallData.map((item) => item.label),
          values: waterfallData.map((item) => item.value),
        },
      };
      // Send response
      res.json(responseData);
    } catch (error) {
      console.error("Error executing Waterfall Chart query:", error);
      res.status(500).json({ message: "Server error during data retrieval" });
    }
  },

 executeHorizontalBarChartQueryV2: async (req, res) => {
  try {
    const card = await Card.findByPk(req.params.id);
    if (!card) return res.status(404).json({ message: "Card not found" });

    const config = JSON.parse(card.config);
    const {
      selectedMachinesByLine = {},
      selectedLineIds = [],
      minDuration,
      maxDuration,
      offsetLimit = 10,
      startDate,
      endDate,
    } = config;

    if (!config.selectedProgramIds || !config.selectedProgramIds.length) {
      return res.status(400).json({ message: "Missing selectedProgramIds in card config." });
    }

    const jobs = await Job.findAll({
      where: { programId: { [Op.in]: config.selectedProgramIds } },
      attributes: ["id"],
    });

    const selectedJobIds = jobs.map((job) => job.id);
    if (!selectedJobIds.length) {
      return res.status(400).json({ message: "No jobs found for selected programs." });
    }

    // Flatten machine IDs
    const selectedMachineIds = Object.values(selectedMachinesByLine || {})
      .flat()
      .filter((id, index, self) => self.indexOf(id) === index);

    // Duration filter
    const hasValidMin = minDuration !== "" && !isNaN(parseFloat(minDuration));
    const hasValidMax = maxDuration !== "" && !isNaN(parseFloat(maxDuration));
    const durationFilter =
      hasValidMin && hasValidMax
        ? "AND AA.duration BETWEEN :min AND :max"
        : hasValidMin
        ? "AND AA.duration >= :min"
        : hasValidMax
        ? "AND AA.duration <= :max"
        : "";

    const replacements = {
      jobIds: selectedJobIds,
      startDate,
      endDate,
    };
    if (hasValidMin) replacements.min = parseFloat(minDuration);
    if (hasValidMax) replacements.max = parseFloat(maxDuration);
    if (selectedLineIds.length) replacements.lineIds = selectedLineIds;
    if (selectedMachineIds.length) replacements.machineIds = selectedMachineIds;

    let groupField, labelField, join = "", whereExtra = "", countExpr;

    if (selectedLineIds.length && selectedMachineIds.length) {
      // Scenario 3: By alarm code with descriptions - using subquery to avoid JOIN issues
      groupField = "AA.alarmCode, AA.machineId, AA.lineId";
      labelField = `
        CONCAT(
          COALESCE(
            (SELECT A.description FROM Alarms A WHERE (${generateAlarmWhereCondition('AA', 'A')}) AND A.machineId = AA.machineId LIMIT 1),
            AA.alarmCode
          ),
          ' (', MAX(AA.machineName), ' - ', MAX(AA.lineName), ')'
        ) AS label`;
      join = "";
      whereExtra = "AND AA.machineId IN (:machineIds) AND AA.lineId IN (:lineIds)";
      countExpr = "COUNT(AA.id) AS count";
    } else if (selectedLineIds.length) {
      // Scenario 2: By machine - ALL machines on the line
      groupField = "AA.machineId, AA.lineId";
      labelField = `CONCAT(MAX(AA.machineName), ' (', MAX(AA.lineName), ')') AS label`;
      join = "";
      whereExtra = "AND AA.lineId IN (:lineIds)";
      countExpr = "COUNT(AA.id) AS count";
    } else {
      // Scenario 1: By line
      groupField = "AA.lineId";
      labelField = `MAX(AA.lineName) AS label`;
      join = "";
      countExpr = "COUNT(AA.id) AS count";
    }

    const fullQuery = `
      SELECT ${groupField} AS labelId, ${labelField},
        ${countExpr},
        SUM(AA.duration) AS duration
      FROM AlarmAggregations AA
      ${join}
      WHERE AA.jobId IN (:jobIds)
        AND AA.alarmStartDateTime >= :startDate
        AND AA.alarmEndDateTime <= :endDate
        ${whereExtra}
        ${durationFilter}
      GROUP BY ${groupField}
      ORDER BY SUM(AA.duration) DESC
    `;

    console.log("=== FINAL DEBUG ===");
    console.log("Card ID:", req.params.id);
    console.log("Scenario:", selectedLineIds.length && selectedMachineIds.length ? "3 (Alarm Codes)" : 
                          selectedLineIds.length ? "2 (Machines)" : "1 (Lines)");
    console.log("selectedMachineIds:", selectedMachineIds);
    console.log("whereExtra:", whereExtra);
    console.log("fullQuery:", fullQuery);
    console.log("replacements:", replacements);

    const allResults = await sequelize.query(fullQuery, {
      replacements,
      type: QueryTypes.SELECT,
    });

    const topResults = allResults
      .sort((a, b) => b.duration - a.duration)
      .slice(0, offsetLimit);

    if (!topResults.length) return res.json({ data: [] });

    const x = topResults.map((r) => ({
      value: r.labelId,
      description: r.label || r.labelId,
    }));

    console.log("=== FINAL RESULTS ===");
    console.log("Total count sum:", topResults.reduce((sum, r) => sum + r.count, 0));
    console.log("Total duration sum:", topResults.reduce((sum, r) => sum + r.duration, 0));
    console.log("Individual counts:", topResults.map(r => r.count));
    console.log("Individual durations:", topResults.map(r => r.duration));
    console.log("Individual labels:", topResults.map(r => r.label));

    return res.json({
      data: [
        {
          x,
          durationX: [...x],
          y: {
            count: topResults.map((r) => r.count),
            duration: topResults.map((r) => r.duration),
          },
          type: "bar",
        },
      ],
    });
  } catch (err) {
    console.error("Error in HorizontalBarChart V2:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
},

 
};


// Helper function to get state label
const getStateLabel = (stateCode) => {
  return STATE_CONFIG.getStateLabel(stateCode);
};

// Helper function to format timestamp with "000" milliseconds
const formatTimestampWithZeroMs = (timestamp) => {
  const utcTime = dayjs(timestamp).utc();
  const formatted = utcTime.format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
  // Replace the actual milliseconds with "000"
  return formatted.replace(/\.\d{3}Z$/, '.000Z');
};

// Helper function to get state color based on value
const getStateColor = (stateCode) => {
  return STATE_CONFIG.getStateColorByCode(stateCode);
};

function getDateRange(year, month, week) {
  if (month) {
    // Establish the first day of the specified month
    const firstDayOfMonth = new Date(Date.UTC(year, month - 1, 1));
    // Find the last day of the specified month
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0));

    if (week) {
      // Calculate the start and end dates for the specified week
      let startDay = (week - 1) * 7 + 1; // Starting from 1st, 8th, 15th, or 22nd day of the month
      let endDay = week * 7; // Ending on 7th, 14th, 21st, or 28th day of the month

      // Adjust start and end days for the 4th week to include days beyond the 28th
      if (week === 4 && lastDayOfMonth.getDate() > 28) {
        endDay = lastDayOfMonth.getDate(); // Set end day to the last day of the month
      }

      const startDate = new Date(Date.UTC(year, month - 1, startDay));
      const endDate = new Date(Date.UTC(year, month - 1, endDay));

      return { startDate, endDate };
    } else {
      // Return the whole month if no week is specified
      return { startDate: firstDayOfMonth, endDate: lastDayOfMonth };
    }
  } else {
    // Return the whole year if no month is specified
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year + 1, 0, 0));
    return { startDate, endDate };
  }
}

function formatForHeatmap(data) {
  // Initialize a 2D array (24 hours by the number of days)
  const hours = 24;
  const days = Array.from(
    new Set(data.map((item) => item.hourOfDay.split(" ")[0]))
  ).length;

  // Create a 2D array filled with zeros
  const heatmapData = Array.from({ length: hours }, () => Array(days).fill(0));

  // Map the data to the correct position in the 2D array
  data.forEach((item) => {
    const { hourOfDay, totalDiffValue } = item;
    const [date, hour] = hourOfDay.split(" ");
    const dayIndex = [
      ...new Set(data.map((item) => item.hourOfDay.split(" ")[0])),
    ].indexOf(date);
    const hourIndex = parseInt(hour, 10);

    // Place the totalDiffValue in the correct hour and day position
    heatmapData[hourIndex][dayIndex] = totalDiffValue;
  });

  // Generate unique xLabels (days) and yLabels (hours)
  const xLabels = [
    ...new Set(
      data.map((item) => item.hourOfDay.split(" ")[0])
    ),
  ];
  const yLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

  return {
    data: heatmapData,
    xLabels: xLabels,
    yLabels: yLabels,
  };
}

const getMonthDateRange = (year, month, week) => {
  const start = new Date(year, month - 1, 1); // Month - 1 because JavaScript months start from 0
  const end = new Date(year, month, 0); // Last day of the month

  if (week) {
    // If a week is specified, adjust the start and end dates
    const dayOfWeek = start.getDay();
    start.setDate(
      start.getDate() + (week - 1) * 7 - dayOfWeek + (dayOfWeek === 0 ? 0 : 1)
    );
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  }

  return { startDate: start, endDate: end };
};

async function getAlarmDuration(machineId, jobId, alarmValue) {
  try {
    // Fetch job
    const job = await Job.findByPk(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    // Use UTC times
    const startTime = dayjs(job.actualStartTime).utc();
    const endTime = dayjs(job.actualEndTime).utc();

    // Fetch tag for alarms
    const tag = await Tags.findOne({
        where: { taggableType: "machine", taggableId: machineId, ref: TagRefs.FIRST_FAULT },
    });
    if (!tag) {
      throw new Error("Tag not found");
    }

    // Fetch tag values
    const tagValues = await TagValues.findAll({
      where: {
        tagId: tag.id,
        createdAt: { [Op.between]: [startTime.toDate(), endTime.toDate()] },
      },
      order: [["createdAt", "ASC"]],
    });

    let totalDuration = 0;
    let currentSequence = [];

    // Process values
    for (let i = 0; i < tagValues.length; i++) {
      const currentValue = tagValues[i];
      const nextValue = tagValues[i + 1];
      const currentNumValue = parseInt(currentValue.value);

      if (currentNumValue === alarmValue) {
        currentSequence.push({
          timestamp: dayjs(currentValue.createdAt)
            .utc()
            .format("MM/DD/YY HH:mm"),
          value: currentNumValue,
          createdAt: currentValue.createdAt,
        });

        // Check for sequence end
        const isEndOfSequence =
          !nextValue ||
          parseInt(nextValue.value) !== alarmValue ||
          dayjs(nextValue.createdAt).diff(
            dayjs(currentValue.createdAt),
            "minute"
          ) > 1;

        if (isEndOfSequence && currentSequence.length > 0) {
          totalDuration += currentSequence.length;
          currentSequence = [];
        }
      }
    }

    return totalDuration;
  } catch (error) {
    console.error("Error in getAlarmDuration:", error);
    return 0;
  }
}
