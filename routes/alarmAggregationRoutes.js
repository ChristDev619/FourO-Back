const express = require("express");
const router = express.Router();
const {
  AlarmAggregation,
  Job,
  Line,
  Machine,
  Tags,
  Reason,
  Alarm,
} = require("../dbInit");

// Get all alarm aggregations with pagination
router.get("/", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page = parseInt(req.query.page) || 0;

    const { count, rows } = await AlarmAggregation.findAndCountAll({
      limit,
      offset: page * limit,
      include: [
        { model: Job, as: "job" },
        { model: Line, as: "line" },
        { model: Machine, as: "machine" },
        { model: Tags, as: "tag" },
        { model: Reason, as: "reason" },
        { model: Alarm, as: "alarmDetails" },
      ],
      order: [["alarmStartDateTime", "DESC"]],
    });

    res.status(200).json({
      total: count,
      pages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching alarm aggregations:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get alarm aggregations by job ID
router.get("/job/:jobId", async (req, res) => {
  try {
    const aggregations = await AlarmAggregation.findAll({
      where: { jobId: req.params.jobId },
      include: [
        { model: Job, as: "job" },
        { model: Line, as: "line" },
        { model: Machine, as: "machine" },
        { model: Tags, as: "tag" },
        { model: Reason, as: "reason" },
      ],
      order: [["alarmStartDateTime", "ASC"]],
    });

    res.status(200).json({ data: aggregations });
  } catch (error) {
    console.error("Error fetching job alarm aggregations:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update alarm note
router.patch("/:id/note", async (req, res) => {
  try {
    const { note } = req.body;
    const aggregation = await AlarmAggregation.findByPk(req.params.id);

    if (!aggregation) {
      return res.status(404).json({ message: "Alarm aggregation not found" });
    }

    aggregation.alarmNote = note;
    await aggregation.save();

    res
      .status(200)
      .json({ message: "Note updated successfully", data: aggregation });
  } catch (error) {
    console.error("Error updating alarm note:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update alarm reason
router.patch("/:id/reason", async (req, res) => {
  try {
    const { reasonId } = req.body;
    const aggregation = await AlarmAggregation.findByPk(req.params.id);

    if (!aggregation) {
      return res.status(404).json({ message: "Alarm aggregation not found" });
    }

    const reason = await Reason.findByPk(reasonId);
    if (!reason) {
      return res.status(404).json({ message: "Reason not found" });
    }

    aggregation.alarmReasonId = reasonId;
    aggregation.alarmReasonName = reason.name;
    await aggregation.save();

    res
      .status(200)
      .json({ message: "Reason updated successfully", data: aggregation });
  } catch (error) {
    console.error("Error updating alarm reason:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update both alarm reason and note
router.patch("/:id", async (req, res) => {
  try {
    const { reasonId, note } = req.body;
    const aggregation = await AlarmAggregation.findByPk(req.params.id);
    
    if (!aggregation) {
      return res.status(404).json({ message: "Alarm aggregation not found" });
    }

    // Update reason if provided
    if (reasonId) {
      const reason = await Reason.findByPk(reasonId);
      if (!reason) {
        return res.status(404).json({ message: "Reason not found" });
      }
      aggregation.alarmReasonId = reasonId;
      aggregation.alarmReasonName = reason.name;
    }

    // Update note if provided
    if (note !== undefined) {
      aggregation.alarmNote = note;
    }

    await aggregation.save();

    // Fetch the updated aggregation with associations
    const updatedAggregation = await AlarmAggregation.findByPk(req.params.id, {
      include: [
        { model: Reason, as: "reason" },
        { model: Alarm, as: "alarmDetails" }
      ]
    });

    res.status(200).json({ 
      message: "Alarm details updated successfully", 
      data: updatedAggregation 
    });
  } catch (error) {
    console.error("Error updating alarm details:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete single alarm aggregation
router.delete("/:id", async (req, res) => {
  try {
    const aggregation = await AlarmAggregation.findByPk(req.params.id);
    
    if (!aggregation) {
      return res.status(404).json({ message: "Alarm aggregation not found" });
    }

    await aggregation.destroy();

    res.status(200).json({ 
      message: "Alarm aggregation deleted successfully",
      deletedId: req.params.id
    });
  } catch (error) {
    console.error("Error deleting alarm aggregation:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete multiple alarm aggregations
router.delete("/", async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Array of IDs is required" });
    }

    const deletedCount = await AlarmAggregation.destroy({
      where: {
        id: ids
      }
    });

    res.status(200).json({ 
      message: `${deletedCount} alarm aggregation(s) deleted successfully`,
      deletedCount,
      requestedIds: ids
    });
  } catch (error) {
    console.error("Error deleting alarm aggregations:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete all alarm aggregations for a specific job
router.delete("/job/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const deletedCount = await AlarmAggregation.destroy({
      where: {
        jobId: jobId
      }
    });

    res.status(200).json({ 
      message: `${deletedCount} alarm aggregation(s) deleted for job ${jobId}`,
      deletedCount,
      jobId: parseInt(jobId)
    });
  } catch (error) {
    console.error("Error deleting job alarm aggregations:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
