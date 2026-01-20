const dayjs = require("dayjs");
const db = require("../dbInit");
const { PlannedDowntime, sequelize } = db;
const XLSX = require("xlsx");
exports.createPlannedDowntime = async (req, res) => {
  try {
    const downtime = await PlannedDowntime.create(req.body);
    res.status(201).send(downtime);
  } catch (error) {
    res.status(400).send(error);
  }
};

exports.getAllPlannedDowntimes = async (req, res) => {
  try {
    const downtimes = await PlannedDowntime.findAll();
    res.status(200).send(downtimes);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getPlannedDowntimeById = async (req, res) => {
  try {
    const downtime = await PlannedDowntime.findByPk(req.params.id);
    if (downtime) {
      res.status(200).send(downtime);
    } else {
      res.status(404).send({ message: "Planned Downtime not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.updatePlannedDowntime = async (req, res) => {
  try {
    const downtime = await PlannedDowntime.update(req.body, {
      where: { id: req.params.id },
    });
    if (downtime == 1) {
      res
        .status(200)
        .send({ message: "Planned Downtime updated successfully." });
    } else {
      res.status(404).send({ message: "Planned Downtime not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.deletePlannedDowntime = async (req, res) => {
  try {
    const downtime = await PlannedDowntime.destroy({
      where: { id: req.params.id },
    });
    if (downtime == 1) {
      res
        .status(200)
        .send({ message: "Planned Downtime deleted successfully." });
    } else {
      res.status(404).send({ message: "Planned Downtime not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getPlannedDowntimeByRefId = async (req, res) => {
  try {
    const downtime = await PlannedDowntime.findOne({
      where: { downtimeRefId: req.params.downtimeRefId },
    });
    if (downtime) {
      res.status(200).send(downtime);
    } else {
      res.status(404).send({ message: "Planned Downtime not found." });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getPlannedDowntimeByReason = async (req, res) => {
  try {
    const downtimes = await PlannedDowntime.findAll({
      where: { downtimeReason: req.params.reason },
    });
    res.status(200).send(downtimes);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getPlannedDowntimeByJobRefId = async (req, res) => {
  try {
    const downtimes = await PlannedDowntime.findAll({
      where: { jobRefId: req.params.jobRefId },
    });
    res.status(200).send(downtimes);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getPlannedDowntimeByLineId = async (req, res) => {
  try {
    const downtimes = await PlannedDowntime.findAll({
      where: { lineId: req.params.lineId },
    });
    res.status(200).send(downtimes);
  } catch (error) {
    res.status(500).send(error);
  }
};

exports.getAllPlannedDowntimesPaginated = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;
    const { count, rows } = await PlannedDowntime.findAndCountAll({
      limit,
      offset: page * limit,
      order: [["createdAt", "DESC"]],
      include: [
        { model: db.Job, as: "job" },
        { model: db.Line, as: "line" },
        { model: db.Reason, as: "downtimeReason" },
      ],
    });
    res.status(200).send({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.log(error);

    res.status(500).send(error);
  }
};

exports.downloadTemplate = async (req, res) => {
  const type = req.query.type;
  // Define the headers and empty row data
  const data =
    type === "plan"
      ? [
          [
            "Job ID",
            "Line ID",
            "Down Time Reason ID",
            "Planned Start Time ",
            "Planned End Time",
            "Down Time Duration",
            "Down Time Type",
            "Notes",
          ],
          ["", "", "", "", "", "", "", ""],
        ]
      : [
          [
            
            "Job Name",
            "Job Description",
            "SKU ID",
            "Line ID",
            "Planned Start Time ",
            "Planned End Time",
            "Planned Production",
          ],
          ["", "", "", "", "", "", "", ""],
        ];

  // Create a new workbook and add the data
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Planned Downtime Template");

  // Write the workbook to a buffer
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Set the response headers for file download
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=planned_downtime_template.xlsx"
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  // Send the buffer to the client
  res.send(buffer);
};

exports.bulkInsertPlannedDowntimes = async (req, res) => {
  try {
    const plannedDowntimes = req.body;

    // Get current timestamp for createdAt and updatedAt
    const currentTime = dayjs().format("YYYY-MM-DD HH:mm:ss");

    // Format datetime values to 'YYYY-MM-DD HH:mm:ss' for MySQL compatibility
    const values = plannedDowntimes
      .map(
        (pd) => `(
        
        '${pd.downtimeReasonId || null}', 
        '${dayjs(pd.plannedStartTime).format("YYYY-MM-DD HH:mm:ss")}', 
        '${dayjs(pd.plannedEndTime).format("YYYY-MM-DD HH:mm:ss")}', 
        '${pd.downtimeDuration || null}', 
        '${pd.downtimeType || null}', 
        '${pd.jobId || null}',
        '${pd.lineId || null}',
        '${pd.notes || null}',
        '${currentTime}',  -- createdAt
        '${currentTime}'   -- updatedAt
      )`
      )
      .join(", "); // Join all values into a single string

    const query = `
      INSERT INTO PlannedDowntimes 
       (downtimeReasonId, plannedStartTime, plannedEndTime, downtimeDuration, downtimeType, jobId, lineId,notes, createdAt, updatedAt) 
      VALUES ${values};
    `;

    // Execute the raw query
    await sequelize.query(query);

    res.status(201).send({ message: "Planned downtimes added successfully." });
  } catch (error) {
    console.error("Error bulk inserting planned downtimes:", error);
    res.status(500).send({ error: "Failed to bulk insert planned downtimes." });
  }
};
