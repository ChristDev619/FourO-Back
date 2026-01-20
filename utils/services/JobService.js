const { Op } = require("sequelize");

class JobService {
  constructor({ Job, JobLineMachineTag }) {
    this.Job = Job;
    this.JobLineMachineTag = JobLineMachineTag;
  }

  async findJobByProgramId(programId, options = {}) {
    const {
      attributes = ["id"],
      order = [["createdAt", "DESC"]],
      raw = true,
      limit = 1,
    } = options;

    return await this.Job.findOne({ where: { programId }, attributes, order, raw, limit });
  }

  async findJobByLineId(lineId, options = {}) {
    const {
      attributes = ["jobId"],
      order = [["plannedEndTime", "DESC"]],
      raw = true,
    } = options;

    return await this.JobLineMachineTag.findOne({ where: { lineId }, attributes, order, raw });
  }

  async getJobIdByProgramId(programId) {
    const job = await this.findJobByProgramId(programId);
    return job ? job.id : null;
  }

  async getJobIdByLineId(lineId) {
    const job = await this.findJobByLineId(lineId);
    return job ? job.jobId : null;
  }

  async findJobsByProgramIds(programIds, options = {}) {
    const {
      attributes = ["id", "programId"],
      order = [["createdAt", "DESC"]],
      raw = true,
    } = options;

    return await this.Job.findAll({
      where: { programId: { [Op.in]: programIds } },
      attributes,
      order,
      raw,
    });
  }

  async jobExistsByProgramId(programId) {
    const count = await this.Job.count({ where: { programId } });
    return count > 0;
  }
}

module.exports = JobService;
