const recalculationQueue = require('./queues/recalculationQueue');

class QueueManager {
  constructor() {
    this.queue = recalculationQueue;
  }

  async getQueueStats() {
    try {
      const counts = await this.queue.getJobCounts();
      const waiting = counts.waiting || 0;
      const active = counts.active || 0;
      const completed = counts.completed || 0;
      const failed = counts.failed || 0;
      const delayed = counts.delayed || 0;
      const paused = counts.paused || 0;
      
      // Check if queue is paused
      const isPaused = await this.queue.isPaused();

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused,
        isPaused,
        total: waiting + active + completed + failed + delayed + paused
      };
    } catch (error) {
      console.error('Error getting queue stats:', error);
      throw error;
    }
  }

  async getJobDetails(jobType = 'all', limit = 10) {
    try {
      let jobs = [];
      
      switch (jobType) {
        case 'waiting':
          jobs = await this.queue.getWaiting(0, limit);
          break;
        case 'active':
          jobs = await this.queue.getActive(0, limit);
          break;
        case 'completed':
          jobs = await this.queue.getCompleted(0, limit);
          break;
        case 'failed':
          jobs = await this.queue.getFailed(0, limit);
          break;
        case 'delayed':
          jobs = await this.queue.getDelayed(0, limit);
          break;
        case 'all':
        default:
          const [waiting, active, completed, failed, delayed] = await Promise.all([
            this.queue.getWaiting(0, limit),
            this.queue.getActive(0, limit),
            this.queue.getCompleted(0, limit),
            this.queue.getFailed(0, limit),
            this.queue.getDelayed(0, limit)
          ]);
          jobs = [...waiting, ...active, ...completed, ...failed, ...delayed];
          break;
      }

      return jobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        status: job.finishedOn ? 'completed' : job.failedReason ? 'failed' : job.processedOn ? 'active' : 'waiting',
        progress: job.progress(),
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        delay: job.delay
      }));
    } catch (error) {
      console.error('Error getting job details:', error);
      throw error;
    }
  }

  async removeJob(jobId) {
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
        console.log(`Job ${jobId} removed successfully`);
        return true;
      } else {
        console.log(`Job ${jobId} not found`);
        return false;
      }
    } catch (error) {
      console.error(`Error removing job ${jobId}:`, error);
      throw error;
    }
  }

  async removeJobsByStatus(status, limit = 100) {
    try {
      let jobs = [];
      
      switch (status) {
        case 'completed':
          jobs = await this.queue.getCompleted(0, limit);
          break;
        case 'failed':
          jobs = await this.queue.getFailed(0, limit);
          break;
        case 'waiting':
          jobs = await this.queue.getWaiting(0, limit);
          break;
        case 'active':
          jobs = await this.queue.getActive(0, limit);
          break;
        case 'delayed':
          jobs = await this.queue.getDelayed(0, limit);
          break;
        default:
          throw new Error(`Invalid status: ${status}`);
      }

      let removedCount = 0;
      for (const job of jobs) {
        await job.remove();
        removedCount++;
      }

      console.log(`Removed ${removedCount} ${status} jobs`);
      return removedCount;
    } catch (error) {
      console.error(`Error removing ${status} jobs:`, error);
      throw error;
    }
  }

  async cleanOldJobs(olderThanHours = 24) {
    try {
      const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
      
      const completed = await this.queue.getCompleted(0, 1000);
      const failed = await this.queue.getFailed(0, 1000);
      
      let removedCount = 0;
      
      // Remove old completed jobs
      for (const job of completed) {
        if (job.finishedOn && job.finishedOn < cutoffTime) {
          await job.remove();
          removedCount++;
        }
      }
      
      // Remove old failed jobs
      for (const job of failed) {
        if (job.finishedOn && job.finishedOn < cutoffTime) {
          await job.remove();
          removedCount++;
        }
      }
      
      console.log(`Removed ${removedCount} old jobs (older than ${olderThanHours} hours)`);
      return removedCount;
    } catch (error) {
      console.error('Error cleaning old jobs:', error);
      throw error;
    }
  }

  async pauseQueue() {
    try {
      await this.queue.pause();
      console.log('Queue paused successfully');
    } catch (error) {
      console.error('Error pausing queue:', error);
      throw error;
    }
  }

  async resumeQueue() {
    try {
      await this.queue.resume();
      console.log('Queue resumed successfully');
    } catch (error) {
      console.error('Error resuming queue:', error);
      throw error;
    }
  }

  async emptyQueue() {
    try {
      await this.queue.empty();
      console.log('Queue emptied successfully');
    } catch (error) {
      console.error('Error emptying queue:', error);
      throw error;
    }
  }
}

module.exports = QueueManager; 