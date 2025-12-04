const Queue = require('bull');

class QueueManager {
  constructor() {
    const redisConfig = {
      redis: {
        host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
        port: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).port : 6379
      }
    };
    
    this.queues = {
      '360p': new Queue('transcoding-360p', redisConfig),
      '720p': new Queue('transcoding-720p', redisConfig),
      '1080p': new Queue('transcoding-1080p', redisConfig)
    };
    
    console.log('✅ Queue manager initialized');
  }
  
  async addTranscodingJob(videoId, videoData) {
    const jobs = [];
    
    for (const [resolution, queue] of Object.entries(this.queues)) {
      const job = await queue.add({
        videoId,
        resolution,
        ...videoData
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: false,
        removeOnFail: false
      });
      
      jobs.push({
        resolution,
        jobId: job.id,
        queue: queue.name
      });
      
      console.log(`📤 Added ${resolution} job: ${job.id} for video: ${videoId}`);
    }
    
    return jobs;
  }
  
  async getJobStatus(resolution, jobId) {
    const queue = this.queues[resolution];
    if (!queue) throw new Error(`Queue not found for resolution: ${resolution}`);
    
    const job = await queue.getJob(jobId);
    if (!job) return null;
    
    const state = await job.getState();
    const progress = job.progress();
    
    return {
      id: job.id,
      state,
      progress,
      data: job.data,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason
    };
  }
  
  async getQueueStats() {
    const stats = {};
    
    for (const [resolution, queue] of Object.entries(this.queues)) {
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount()
      ]);
      
      stats[resolution] = {
        waiting,
        active,
        completed,
        failed,
        total: waiting + active + completed + failed
      };
    }
    
    return stats;
  }
  
  async getQueue(resolution) {
    return this.queues[resolution];
  }
  
  async closeAll() {
    for (const queue of Object.values(this.queues)) {
      await queue.close();
    }
    console.log('✅ All queues closed');
  }
}

module.exports = new QueueManager();