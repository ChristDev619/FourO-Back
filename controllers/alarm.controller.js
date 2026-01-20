const db = require("../dbInit");
const { Alarm, sequelize, AlarmMachineLineView, Op } = db;

exports.createAlarms = async (req, res) => {
  try {
    const alarms = req.body; // Expect an array of alarm objects

    // Check if any alarms with the same name already exist for the same machine
    const existingAlarms = await Alarm.findAll({
      where: {
        [Op.or]: alarms.map(({ name, machineId }) => ({
          name,
          machineId,
        })),
      },
    });

    if (existingAlarms.length > 0) {
      return res.status(400).send({ message: "exists" });
    }

    // Create alarms only if no duplicates exist
    const createdAlarms = await Alarm.bulkCreate(alarms, { validate: true });

    res.status(201).send(createdAlarms);
  } catch (error) {
    console.error("Error creating alarms:", error);
    res.status(500).send({ message: "An error occurred while creating alarms." });
  }
};

exports.getAllAlarms = async (req, res) => {
  try {
    const alarms = await Alarm.findAll();
    res.status(200).send(alarms);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAlarmById = async (req, res) => {
  try {
    const alarm = await Alarm.findByPk(req.params.id);
    if (alarm) {
      res.status(200).send(alarm);
    } else {
      res.status(404).send({ message: "Alarm not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updateAlarm = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, machineId } = req.body;

    // Check if the alarm exists
    const alarm = await Alarm.findByPk(id);
    if (!alarm) {
      return res.status(404).send({ message: "Alarm not found." });
    }

    // Check if another alarm with the same name already exists for the same machine
    const existingAlarm = await Alarm.findOne({
      where: {
        name,
        machineId,
        id: { [Op.ne]: id }, // Exclude the current alarm
      },
    });

    if (existingAlarm) {
      return res.status(400).send({ message: "exists" }); // Prevent duplicate names
    }

    // Update the alarm
    await alarm.update(req.body);

      res.status(200).send({ message: "Alarm updated successfully." });

  } catch (error) {
    console.error("Error updating alarm:", error);
    res.status(500).send({ message: "An error occurred while updating the alarm." });
  }
};

exports.deleteAlarm = async (req, res) => {
  try {
    const alarm = await Alarm.destroy({
      where: { id: req.params.id },
    });
    if (alarm == 1) {
      res.status(200).send({ message: "Alarm deleted successfully." });
    } else {
      res.status(404).send({ message: "Alarm not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAlarmByName = async (req, res) => {
  try {
    const alarm = await Alarm.findOne({ where: { name: req.params.name } });
    if (alarm) {
      res.status(200).send(alarm);
    } else {
      res.status(404).send({ message: "Alarm not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllAlarmsPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { count, rows } = await AlarmMachineLineView.findAndCountAll({
      limit,
      offset: page * limit,
      order: [["alarmId", "DESC"]],
    });

    res.status(200).send({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching paginated alarms:", error);
    res.status(500).send(error);
  }
};  

exports.bulkInsertAlarms = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    // Step 1: Parse & validate input
    const validAlarms = req.body
      .map(alarm => ({
        name: alarm.name || '',
        description: alarm.description || null,
        machineId: alarm.machineId != null ? Number(alarm.machineId) : null
      }))
      .filter(alarm => 
        !isNaN(alarm.machineId) && 
        alarm.machineId !== null &&
        alarm.machineId > 0
      );

    if (validAlarms.length === 0) {
      return res.status(400).json({
        message: "No valid alarms provided: machineId must be a valid positive number"
      });
    }

    // Step 2: Filter out alarms that already exist in DB
    const whereDuplicates = {
      [Op.or]: validAlarms.map(a => ({
        name: a.name,
        machineId: a.machineId
      }))
    };
    const existingAlarms = await Alarm.findAll({
      where: whereDuplicates,
      attributes: ['name', 'machineId']
    });
    const existingSet = new Set(
      existingAlarms.map(e => `${e.name}|${e.machineId}`)
    );
    const alarmsToInsert = [];
    const skippedAlarms = [];

    for (const a of validAlarms) {
      const key = `${a.name}|${a.machineId}`;
      if (existingSet.has(key)) {
        skippedAlarms.push({ name: a.name, machineId: a.machineId, reason: "Already exists in DB" });
      } else {
        alarmsToInsert.push(a);
      }
    }

    // Step 3: Remove in-batch duplicates
    const uniqueMap = new Map();
    for (const alarm of alarmsToInsert) {
      const key = `${alarm.name}|${alarm.machineId}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, alarm);
      } else {
        skippedAlarms.push({ name: alarm.name, machineId: alarm.machineId, reason: "Duplicate in upload" });
      }
    }
    const uniqueAlarmsToInsert = Array.from(uniqueMap.values());

    // Step 4: Nothing left to insert?
    if (uniqueAlarmsToInsert.length === 0) {
      await t.rollback();
      return res.status(200).json({
        message: "All alarms already exist or were duplicates.",
        createdCount: 0,
        totalProcessed: validAlarms.length,
        skippedCount: skippedAlarms.length,
        skippedAlarms
      });
    }

    // Step 5: Bulk insert
    await Alarm.bulkCreate(uniqueAlarmsToInsert, { validate: true, transaction: t });

    await t.commit();

    return res.status(201).json({
      message: `${uniqueAlarmsToInsert.length} alarm(s) created successfully.`,
      createdCount: uniqueAlarmsToInsert.length,
      totalProcessed: validAlarms.length,
      skippedCount: skippedAlarms.length,
      skippedAlarms
    });

  } catch (error) {
    await t.rollback();
    console.error("Error inserting Alarms:", error);

    if (error.name === "SequelizeUniqueConstraintError" && error.errors) {
      return res.status(400).json({
        message: "Duplicate alarms detected. Some records violate unique constraints.",
        sequelizeErrors: error.errors.map(e => ({
          message: e.message,
          fields: e.fields,
          value: e.value,
          type: e.type
        }))
      });
    }

    return res.status(500).json({
      message: "Failed to insert Alarms",
      error: {
        message: error.message,
        code: error.code,
        sqlMessage: error.sqlMessage
      }
    });
  }
};


exports.getAlarmsByLine = async (req, res) => {
  try {
    const lineId = req.query.lineId;

    if (!lineId) {
      return res.status(400).json({
        message: "Line ID is required",
      });
    }

    const alarms = await AlarmMachineLineView.findAll({
      where: { lineId },
    });

    res.status(200).json({
      data: alarms,
    });
  } catch (error) {
    console.error("Error fetching alarms by line:", error);
    res.status(500).json({
      message: "Failed to fetch alarms",
      error: error.message,
    });
  }
};
