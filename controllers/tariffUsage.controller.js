// controllers/tariffUsage.controller.js
const dayjs = require("dayjs");
const logger = require("../utils/logger");
const {
  TariffUsage,
  Tariff,
  Op,
  Unit,
  Meters,
  Tags,
  TagValues,
  Generator,
} = require("../dbInit");

exports.getAllTariffUsagePaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;

    const { count, rows } = await TariffUsage.findAndCountAll({
      limit,
      offset: page * limit,
      include: ["tariff"],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).send({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.createTariffUsage = async (req, res) => {
  try {
    const { tariffId } = req.body;
    let startDate = dayjs(req.body.startDate)
      .hour(0)
      .minute(0)
      .second(0)
      .millisecond(0)
      .format("YYYY-MM-DD HH:mm:ss");
    let endDate = dayjs(req.body.endDate)
      .hour(23)
      .minute(59)
      .second(59)
      .millisecond(59)
      .format("YYYY-MM-DD HH:mm:ss");
    // Check if there is any overlap with existing tariff usages
    const overlap = await TariffUsage.findOne({
      where: {
        [Op.or]: [
          {
            startDate: {
              [Op.between]: [startDate, endDate],
            },
          },
          {
            endDate: {
              [Op.between]: [startDate, endDate],
            },
          },
          {
            [Op.and]: [
              { startDate: { [Op.lte]: startDate } },
              { endDate: { [Op.gte]: endDate } },
            ],
          },
        ],
        tariffId, // Assuming you want to check overlaps for the same tariffId
      },
    });

    if (overlap) {
      return res.status(400).json({
        message:
          "A tariff usage already exists within the specified date range.",
      });
    }

    // Create new tariff usage if no overlap is found
    const newTariffUsage = await TariffUsage.create({
      startDate,
      endDate,
      tariffId,
    });
    res.status(201).send(newTariffUsage);
  } catch (error) {
    logger.error("Error creating tariff usage", { error: error.message, stack: error.stack });
    res.status(500).send(error);
  }
};

exports.updateTariffUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate, tariffId } = req.body;
    const updated = await TariffUsage.update(
      { startDate, endDate, tariffId },
      { where: { id } }
    );
    if (updated) {
      const updatedTariffUsage = await TariffUsage.findOne({ where: { id } });
      res.status(200).send(updatedTariffUsage);
    } else {
      res.status(404).send({ message: "Tariff Usage not found" });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.deleteTariffUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await TariffUsage.destroy({ where: { id } });
    if (deleted) {
      res.status(200).send({ message: "Tariff Usage deleted" });
    } else {
      res.status(404).send({ message: "Tariff Usage not found" });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getTariffUsageByDate = async (req, res) => {
  try {
    const { from, to } = req.query;
    const usages = await TariffUsage.findAll({
      where: {
        startDate: { [Op.between]: [new Date(from), new Date(to)] },
      },
      include: ["tariff"],
    });
    res.status(200).send(usages);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.searchTariffUsageBySupplier = async (req, res) => {
  try {
    const { supplier } = req.query;
    const usages = await TariffUsage.findAll({
      include: {
        model: Tariff,
        as: "tariff",
        where: { supplier: { [Op.like]: `%${supplier}%` } },
      },
    });
    res.status(200).send(usages);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.calculateConsumption = async (req, res) => {
  const { kwhPerLiter } = req.body;

  const fromDate = dayjs(req.body.fromDate)
    .hour(0)
    .minute(0)
    .second(0)
    .millisecond(0)
    .format("YYYY-MM-DD HH:mm:ss");

  const toDate = dayjs(req.body.toDate)
    .hour(23)
    .minute(59)
    .second(59)
    .millisecond(999)
    .format("YYYY-MM-DD HH:mm:ss");
  try {
    // Fetch the unit ID for "kwh"
    const kwhUnit = await Unit.findOne({
      where: { name: "kwh" },
    });
    if (!kwhUnit) {
      return res.status(404).json({ message: "Unit 'kwh' not found" });
    }
    const unitId = kwhUnit.id;

    // Fetch all tariff usages between the from and to dates
    const tariffUsages = await TariffUsage.findAll({
      where: {
        startDate: {
          [Op.between]: [fromDate, toDate],
        },
      },
      include: [{ model: Tariff, as: "tariff" }],
      order: [["endDate", "ASC"]],
    });

    const results = [];
    for (const usage of tariffUsages) {
      const { startDate, endDate, tariff } = usage;

      // Fetch all meters related to generators for this tariff usage
      const meters = await Meters.findAll({
        where: {
          generatorId: { [Op.ne]: null },
          type: "generator",
          machineId: null,
        },
      });

      let totalConsumption = 0;
      for (const meter of meters) {
        const tag = await Tags.findOne({
          where: {
            taggableId: meter.id,
            taggableType: "meter",
            unitId: unitId, // Use the dynamically fetched unitId
          },
        });

        if (tag) {
          const firstTagValue = await TagValues.findOne({
            where: {
              tagId: tag.id,
              createdAt: { [Op.gte]: startDate, [Op.lte]: endDate },
            },
            order: [["createdAt", "ASC"]],
          });

          const lastTagValue = await TagValues.findOne({
            where: {
              tagId: tag.id,
              createdAt: { [Op.gte]: startDate, [Op.lte]: endDate },
            },
            order: [["createdAt", "DESC"]],
          });

          if (firstTagValue && lastTagValue) {
            totalConsumption += lastTagValue.value - firstTagValue.value;
          }
        }
      }

      const pricePerLiter = tariff.pricePerLiter;
      const pricePerKwh = pricePerLiter / kwhPerLiter;
      const totalConsumptionPrice = pricePerKwh * totalConsumption;

      results.push({
        startDate: new Date(startDate).toLocaleDateString("en-CA"),
        endDate: new Date(endDate).toLocaleDateString("en-CA"),
        pricePerKwh: Math.round(pricePerKwh * 100) / 100,
        pricePerLiter,
        totalKwh: totalConsumption,
        totalConsumptionPrice: Math.round(totalConsumptionPrice * 100) / 100,
      });
    }

    res.status(200).json(results);
  } catch (error) {
    logger.error("Error fetching consumption rate", { error: error.message, stack: error.stack });
    res.status(500).json({ message: "Failed to fetch consumption rate." });
  }
};
