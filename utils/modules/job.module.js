// utils/modules/job.module.js

const JobService = require("../services/JobService");
const { Job, JobLineMachineTag } = require("../../dbInit");

const jobService = new JobService({
  Job,
  JobLineMachineTag,
});

module.exports = jobService;