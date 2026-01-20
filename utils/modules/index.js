const JobService = require("../services/JobService");
const OEETimeSeriesService = require("../services/OEETimeSeriesService");
const tagSubscriptionService = require("../services/TagSubscriptionService");
const { Job, JobLineMachineTag, OEETimeSeries } = require("../../dbInit");
const { recalculateAggregatesForJob } = require("./recalculate.module");

const jobService = new JobService({ Job, JobLineMachineTag });
const oeeTimeSeriesService = new OEETimeSeriesService({ OEETimeSeries });

module.exports = {
  jobService,
  oeeTimeSeriesService,
  tagSubscriptionService,
  recalculateAggregatesForJob,
  // ...add more as you create new services
};