const db = require("../dbInit");
const {
  GeneratorMachineMeterTagValues,
  Op,
  Card,
  Tags,
  TagValues,
  Meters,
  Generator,
  TagDailyAggregates,
  sequelize,
} = require("../dbInit");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);

// Controller function to get all data from the view
exports.getAllData = async (req, res) => {
  try {
    const data = await GeneratorMachineMeterTagValues.findAll();
    res.status(200).send(data);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
};

// exports.executeSankeyCardConfig = async (req, res) => {
//   const { cardId } = req.body;

//   const card = await Card.findByPk(cardId);
//   if (!card) {
//     return res.status(404).json({ message: "Card not found" });
//   }

//   const config = JSON.parse(card.config);
//   const {
//     selectedGenerators,
//     selectedMeters,
//     selectedTags,
//     unit,
//     dateFrom,
//     dateTo,
//   } = config;
//   const unitId = unit.id;
//   const startDate = dayjs(dateFrom)
//     .hour(0)
//     .minute(0)
//     .second(0)
//     .millisecond(0)
//     .format("YYYY-MM-DD HH:mm:ss");
//   const endDate = dayjs(dateTo)
//     .hour(23)
//     .minute(59)
//     .second(59)
//     .millisecond(999)
//     .format("YYYY-MM-DD HH:mm:ss");

//   try {
//     // Fetching tag values from custom view
//     const receivers = await GeneratorMachineMeterTagValues.findAll({
//       attributes: [
//         "meter_id",
//         [sequelize.fn("max", sequelize.col("meter_name")), "meter_name"],
//         [sequelize.fn("max", sequelize.col("meter_type")), "meter_type"],
//         [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
//         [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
//         [sequelize.fn("max", sequelize.col("tag_unit_id")), "tag_unit_id"],
//       ],
//       where: {
//         meter_type: {
//           [Op.in]: ["receiver"],
//         },
//       },
//       group: ["meter_id"],
//     });

//     const generators = await GeneratorMachineMeterTagValues.findAll({
//       attributes: [
//         [sequelize.fn("max", sequelize.col("generator_id")), "generator_id"],
//         [
//           sequelize.fn("max", sequelize.col("generator_name")),
//           "generator_name",
//         ],
//         [sequelize.fn("max", sequelize.col("tariffType")), "tariffType"],
//         "meter_id",
//         [sequelize.fn("max", sequelize.col("meter_name")), "meter_name"],
//         [sequelize.fn("max", sequelize.col("meter_type")), "meter_type"],
//         [sequelize.fn("max", sequelize.col("tag_id")), "tag_id"],
//         [sequelize.fn("max", sequelize.col("tag_name")), "tag_name"],
//         [sequelize.fn("max", sequelize.col("tag_unit_id")), "tag_unit_id"],
//       ],
//       where: {
//         meter_type: {
//           [Op.in]: ["generator"],
//         },
//       },
//       group: ["meter_id"],
//     });

//     // Helper function to calculate the energy value difference
//     async function calculateValues(tags, type) {
//       return Promise.all(
//         tags.map(async (tag) => {
//           try {
//             const aggregates = await TagDailyAggregates.findAll({
//               where: {
//                 tagId: tag.tag_id,
//                 date: {
//                   [Op.between]: [startDate, endDate],
//                 },
//               },
//               attributes: [
//                 [sequelize.fn("max", sequelize.col("max_Value")), "maxValue"],
//                 [sequelize.fn("min", sequelize.col("min_Value")), "minValue"],
//               ],
//               raw: true,
//             });

//             const maxValue = aggregates.length
//               ? parseFloat(aggregates[0].maxValue)
//               : 0;
//             const minValue = aggregates.length
//               ? parseFloat(aggregates[0].minValue)
//               : 0;

//             return type === "generators"
//               ? {
//                   name: `${tag.generator_name} (${(maxValue - minValue).toFixed(
//                     2
//                   )} kwh)`,
//                   fuelType: tag.fuelType,
//                   value: maxValue - minValue,
//                 }
//               : {
//                   name: `${tag.meter_name} (${(maxValue - minValue).toFixed(
//                     2
//                   )} kwh)`,
//                   value: maxValue - minValue,
//                 };
//           } catch (err) {
//             console.error("Error calculating values for tag:", tag.tag_id, err);
//             return {
//               name: `${tag.generator_name} (error)`,
//               fuelType: tag.fuelType,
//               value: 0,
//             };
//           }
//         })
//       );
//     }

//     const generatorValues = await calculateValues(generators, "generators");

//     const receiverValues = await calculateValues(receivers, "receivers");

//     //  return res.status(200).json({ generatorValues, receiverValues });

//     // Calculate the total values for each fuel type
//     const totalByFuelType = generatorValues.reduce((acc, generator) => {
//       acc[generator.fuelType] =
//         (acc[generator.fuelType] || 0) + generator.value;
//       return acc;
//     }, {});

//     // Calculate the overall total delivered value
//     const totalDeliveredValue = Object.values(totalByFuelType).reduce(
//       (acc, value) => acc + value,
//       0
//     );

//     // Initialize nodes and links arrays for Plotly
//     const nodes = [];
//     const links = [];

//     // Map to store indexes of nodes to ensure they are referenced correctly in links
//     const nodeIndex = {};

//     const addNode = (name) => {
//       if (!nodeIndex.hasOwnProperty(name)) {
//         nodeIndex[name] = nodes.length;
//         nodes.push({ name });
//       }
//       return nodeIndex[name];
//     };

//     // Adding generator nodes and their links to fuel types
//     generatorValues.forEach((generator) => {
//       const generatorIndex = addNode(generator.name);
//       const fuelTypeIndex = addNode(`Fuel Type: ${generator.fuelType}`);
//       links.push({
//         source: generatorIndex,
//         target: fuelTypeIndex,
//         value: generator.value,
//       });
//     });

//     // Add fuel type nodes and their link to the total delivered node
//     const totalDeliveredIndex = addNode(
//       "Total Delivered - " + totalDeliveredValue.toFixed(2) + " kwh"
//     );
//     Object.keys(totalByFuelType).forEach((fuelType) => {
//       const fuelTypeIndex = addNode(`Fuel Type: ${fuelType}`);
//       links.push({
//         source: fuelTypeIndex,
//         target: totalDeliveredIndex,
//         value: totalByFuelType[fuelType],
//       });
//     });

//     // Adding receiver nodes and their links to the total delivered
//     receiverValues.forEach((receiver) => {
//       const receiverIndex = addNode(receiver.name);
//       links.push({
//         source: totalDeliveredIndex,
//         target: receiverIndex,
//         value: receiver.value,
//       });
//     });
//     res.json({
//       nodes,
//       links,
//     });
//   } catch (error) {
//     console.error("Error generating Sankey chart:", error);
//     res.status(500).send("Failed to generate Sankey chart");
//   }
// };

// exports.executeHeatmapCardConfig = async (req, res) => {
//   const { cardId } = req.body;

//   try {
//     const card = await Card.findByPk(cardId);
//     if (!card) {
//       return res.status(404).json({ message: "Card not found" });
//     }

//     const config = JSON.parse(card.config);
//     const { selectedGenerator, selectedMeter, selectedTag, year, month, week } =
//       config;
//     const unit = await db.Unit.findOne({ where: { name: "kwh" } });

//     if (!unit) {
//       return res.status(404).json({ message: "Unit not found" });
//     }

//     let startDate, endDate;
//     if (year && month && week) {
//       startDate = new Date(Date.UTC(year, month - 1, (week - 1) * 7 + 1));
//       endDate = new Date(Date.UTC(year, month - 1, week * 7));
//       console.log(startDate, "startDate");
//       console.log(endDate, "endDate");
//       console.log(year, "year");
//       console.log(month, "month");
//       console.log(week, "week", startDate, "startdate");
//     } else if (year && month) {
//       startDate = new Date(Date.UTC(year, month - 1, 1));
//       endDate = new Date(Date.UTC(year, month, 0)); // This might need adjustment to get the last day correctly
//     } else if (year) {
//       startDate = new Date(Date.UTC(year, 0, 1));
//       endDate = new Date(Date.UTC(year, 11, 31));
//     } else {
//       return res.status(400).json({ message: "Invalid date range provided" });
//     }

//     const rawData = await TagValues.findAll({
//       where: {
//         tagId: selectedTag.id,
//         createdAt: { [Op.between]: [startDate, endDate] },
//       },
//       attributes: ["createdAt", "value"],
//       order: [["createdAt", "ASC"]],
//     });

//     const heatmapData = rawData.reduce((acc, curr) => {
//       const date = new Date(curr.createdAt);

//       const hour =
//         year && month && week ? date.getHours() - 3 : date.getHours() - 2;
//       const day = date.getDate();
//       if (!acc[day]) {
//         acc[day] = {};
//       }
//       if (!acc[day][hour]) {
//         acc[day][hour] = {
//           firstValue: curr.value,
//           lastValue: curr.value,
//           firstDate: curr.createdAt,
//           lastDate: curr.createdAt,
//         };
//       } else {
//         if (curr.createdAt < acc[day][hour].firstDate) {
//           acc[day][hour].firstValue = curr.value;
//           acc[day][hour].firstDate = curr.createdAt;
//         }
//         if (curr.createdAt > acc[day][hour].lastDate) {
//           acc[day][hour].lastValue = curr.value;
//           acc[day][hour].lastDate = curr.createdAt;
//         }
//       }
//       return acc;
//     }, {});

//     // Prepare data for the heatmap component
//     const xLabels = Object.keys(heatmapData).map((day) => `Day ${day}`);
//     const yLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
//     const data = yLabels.map((_, hourIndex) =>
//       xLabels.map((day) => {
//         const dayIndex = parseInt(day.split(" ")[1]);
//         const hourData =
//           heatmapData[dayIndex] && heatmapData[dayIndex][hourIndex];
//         return hourData ? hourData.lastValue - hourData.firstValue : 0;
//       })
//     );

//     res.status(200).json({
//       xLabels,
//       yLabels,
//       data,
//     });
//   } catch (error) {
//     console.error("Error fetching heatmap data:", error);
//     res.status(500).json({ message: "Failed to fetch heatmap data." });
//   }
// };

exports.withMetersAndTagsByUnit = async (req, res) => {
  const { unitId } = req.body;
  const type = req.query.type === "generation" ? "generator" : "receiver";
  try {
    let results = [];
    
    if (type === "generator") {
      // For generators, use the existing view
      results = await GeneratorMachineMeterTagValues.findAll({
        where: {
          tag_unit_id: unitId,
          meter_type: type,
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
    } else {
      // For receivers, query meters and tags directly
      const receiversQuery = `
        SELECT 
          NULL as generator_id,
          NULL as generator_name,
          NULL as tariffType,
          NULL as machine_id,
          NULL as machine_name,
          m.id as meter_id,
          m.name as meter_name,
          m.type as meter_type,
          t.id as tag_id,
          t.name as tag_name,
          t.unitId as tag_unit_id
        FROM meters m
        LEFT JOIN tags t ON t.taggableId = m.id AND t.taggableType = 'meter'
        WHERE m.type = 'receiver' AND t.unitId = ${unitId}
      `;
      
      results = await sequelize.query(receiversQuery, {
        type: sequelize.QueryTypes.SELECT
      });
    }

    const generators = {};
    const meters = {};
    const tags = {};
    console.log(results, "results");
    
    results.forEach((result) => {
      const generatorId = result.generator_id;
      const generatorName = result.generator_name;
      const tariffType = result.tariffType;
      const meterId = result.meter_id;
      const meterName = result.meter_name;
      const tagId = result.tag_id;
      const tagName = result.tag_name;

      // Only create generator entries if generator_id is not null (for generation type)
      if (generatorId && !generators[generatorId]) {
        generators[generatorId] = {
          id: generatorId,
          name: generatorName,
          tariffType: tariffType,
        };
      }

      if (!meters[meterId]) {
        meters[meterId] = {
          id: meterId,
          name: meterName,
          generatorId: generatorId,
        };
      }

      if (!tags[tagId]) {
        tags[tagId] = { id: tagId, name: tagName, meterId: meterId };
      }
    });

    res.status(200).json({
      generators: Object.values(generators),
      meters: Object.values(meters),
      tags: Object.values(tags),
    });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};

exports.withMetersAndTagsByTarifftype = async (req, res) => {
  const { unitId } = req.body;
  const tariffTypeId = req.query.tariffTypeId;
  try {
    const results = await GeneratorMachineMeterTagValues.findAll({
      where: {
        tag_unit_id: unitId,
        tariff_type_id: tariffTypeId,
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

    const generators = {};
    const meters = {};
    const tags = {};
    console.log(results, "results");
    results.forEach((result) => {
      const generatorId = result.generator_id;
      const generatorName = result.generator_name;
      const tariffType = result.tariffType;
      const meterId = result.meter_id;
      const meterName = result.meter_name;
      const tagId = result.tag_id;
      const tagName = result.tag_name;

      if (!generators[generatorId]) {
        generators[generatorId] = {
          id: generatorId,
          name: generatorName,
          tariffType: tariffType,
        };
      }

      if (!meters[meterId]) {
        meters[meterId] = {
          id: meterId,
          name: meterName,
          generatorId: generatorId,
        };
      }

      if (!tags[tagId]) {
        tags[tagId] = { id: tagId, name: tagName, meterId: meterId };
      }
    });

    res.status(200).json({
      generators: Object.values(generators),
      meters: Object.values(meters),
      tags: Object.values(tags),
    });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};
exports.withMetersAndTagsByUnitAll = async (req, res) => {
  const { unitId } = req.body;

  try {
    // Query 1: Get generator meters from the view
    const generatorResults = await GeneratorMachineMeterTagValues.findAll({
      where: {
        tag_unit_id: unitId,
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

    // Query 2: Get receiver meters directly from meters+tags tables
    const receiverResults = await sequelize.query(`
      SELECT 
        NULL AS generator_id,
        NULL AS generator_name,
        NULL AS tariffType,
        m.id AS machine_id,
        m.name AS machine_name,
        mt.id AS meter_id,
        mt.name AS meter_name,
        mt.type AS meter_type,
        t.id AS tag_id,
        t.name AS tag_name,
        t.unitId AS tag_unit_id
      FROM meters mt
      LEFT JOIN machines m ON mt.machineId = m.id
      LEFT JOIN tags t ON (mt.id = t.taggableId AND t.taggableType = 'meter')
      WHERE mt.type = 'receiver' AND t.unitId = ${unitId}
    `, { type: sequelize.QueryTypes.SELECT });

    // Merge both results
    const results = [...generatorResults, ...receiverResults];

    const generators = {};
    const meters = {};
    const tags = {};
    console.log(results, "results (including receivers)");
    
    results.forEach((result) => {
      const generatorId = result.generator_id;
      const generatorName = result.generator_name;
      const tariffType = result.tariffType;
      const meterId = result.meter_id;
      const meterName = result.meter_name;
      const meterType = result.meter_type;
      const tagId = result.tag_id;
      const tagName = result.tag_name;

      // Only add generator if it exists (will be NULL for receiver meters)
      if (generatorId && !generators[generatorId]) {
        generators[generatorId] = {
          id: generatorId,
          name: generatorName,
          tariffType: tariffType,
        };
      }

      if (meterId && !meters[meterId]) {
        meters[meterId] = {
          id: meterId,
          name: meterName,
          meterType: meterType,  // Include meter type
          generatorId: generatorId,  // Will be NULL for receivers
        };
      }

      if (tagId && !tags[tagId]) {
        tags[tagId] = { 
          id: tagId, 
          name: tagName, 
          meterId: meterId,
          meterType: meterType,  // Include meter type for frontend filtering
        };
      }
    });

    res.status(200).json({
      generators: Object.values(generators),
      meters: Object.values(meters),
      tags: Object.values(tags),
    });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};

exports.withMetersAndTagsByUnitAllNoUnit = async (req, res) => {
  const { unitId } = req.body;

  try {
    // Query 1: Get generator meters from the view
    const generatorResults = await GeneratorMachineMeterTagValues.findAll({
      // where: {
      //   tag_unit_id: unitId,
      // },
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

    // Query 2: Get receiver meters directly from meters+tags tables
    const receiverResults = await sequelize.query(`
      SELECT 
        NULL AS generator_id,
        NULL AS generator_name,
        NULL AS tariffType,
        m.id AS machine_id,
        m.name AS machine_name,
        mt.id AS meter_id,
        mt.name AS meter_name,
        mt.type AS meter_type,
        t.id AS tag_id,
        t.name AS tag_name,
        t.unitId AS tag_unit_id
      FROM meters mt
      LEFT JOIN machines m ON mt.machineId = m.id
      LEFT JOIN tags t ON (mt.id = t.taggableId AND t.taggableType = 'meter')
      WHERE mt.type = 'receiver'
    `, { type: sequelize.QueryTypes.SELECT });

    // Merge both results
    const results = [...generatorResults, ...receiverResults];

    const generators = {};
    const meters = {};
    const tags = {};
    console.log(results, "results (including receivers)");
    
    results.forEach((result) => {
      const generatorId = result.generator_id;
      const generatorName = result.generator_name;
      const tariffType = result.tariffType;
      const meterId = result.meter_id;
      const meterName = result.meter_name;
      const meterType = result.meter_type;
      const tagId = result.tag_id;
      const tagName = result.tag_name;

      // Only add generator if it exists (will be NULL for receiver meters)
      if (generatorId && !generators[generatorId]) {
        generators[generatorId] = {
          id: generatorId,
          name: generatorName,
          tariffType: tariffType,
        };
      }

      if (meterId && !meters[meterId]) {
        meters[meterId] = {
          id: meterId,
          name: meterName,
          meterType: meterType,  // NOW INCLUDES TYPE
          generatorId: generatorId,  // Will be NULL for receivers
        };
      }

      if (tagId && !tags[tagId]) {
        tags[tagId] = { 
          id: tagId, 
          name: tagName, 
          meterId: meterId,
          meterType: meterType,  // ADD THIS for frontend filtering
        };
      }
    });

    res.status(200).json({
      generators: Object.values(generators),
      meters: Object.values(meters),
      tags: Object.values(tags),
    });
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
};
