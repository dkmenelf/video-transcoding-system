require('dotenv').config();
const Queue = require('bull');
const { Pool } = require('pg');
const Minio = require('minio');
const path = require('path');
const fs = require('fs');
const transcoder = require('./transcoder');

// Worker configuration from environment
const WORKER_ID = process.env.WORKER_ID || '360p';
const RESOLUTION = process.env.WORKER_ID || '360p';

console.log(`🤖 Starting Worker: ${WORKER_ID}`);

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// MinIO client
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123'
});

// Queue connection
const redisConfig = {
  redis: {
    host: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).hostname : 'localhost',
    port: process.env.REDIS_URL ? new URL(process.env.REDIS_URL).port : 6379
  }
};

const queue = new Queue(`transcoding-${RESOLUTION}`, redisConfig);

// Ensure working directories exist
const workDir = '/tmp/transcoding';
const inputDir = path.join(workDir, 'input');
const outputDir = path.join(workDir, 'output');

[inputDir, outputDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Process transcoding jobs
queue.process(async (job, done) => {
  const { videoId, objectName, originalFilename } = job.data;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎬 New Job: ${job.id}`);
  console.log(`   Video ID: ${videoId}`);
  console.log(`   Resolution: ${RESOLUTION}`);
  console.log(`   File: ${originalFilename}`);
  console.log(`${'='.repeat(60)}\n`);
  
  const inputPath = path.join(inputDir, `${videoId}_original.mp4`);
  const outputFilename = `${videoId}_${RESOLUTION}.mp4`;
  const outputPath = path.join(outputDir, outputFilename);
  
  try {
    // Update job status in database
    await updateJobStatus(videoId, RESOLUTION, 'processing', WORKER_ID);
    
    // Step 1: Download original video from MinIO
    console.log('📥 Step 1: Downloading original video...');
    await minioClient.fGetObject('original-videos', objectName, inputPath);
    const inputStats = fs.statSync(inputPath);
    console.log(`✅ Downloaded: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);
    
    job.progress(10);
    
    // Step 2: Get video info
    console.log('📊 Step 2: Analyzing video...');
    const videoInfo = await transcoder.getVideoInfo(inputPath);
    console.log(`   Duration: ${videoInfo.duration.toFixed(2)}s`);
    console.log(`   Original: ${videoInfo.video.width}x${videoInfo.video.height}`);
    console.log(`   FPS: ${videoInfo.video.fps.toFixed(2)}`);
    
    job.progress(20);
    
    // Step 3: Transcode video
    console.log(`🎞️  Step 3: Transcoding to ${RESOLUTION}...`);
    
    const result = await transcoder.transcode(
      inputPath,
      outputPath,
      RESOLUTION,
      (progress) => {
        // Update progress: 20-80%
        const totalProgress = 20 + (progress.percent * 0.6);
        job.progress(Math.min(totalProgress, 80));
      }
    );
    
    console.log(`✅ Output size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
    
    job.progress(85);
    
    // Step 4: Upload transcoded video to MinIO
    console.log('📤 Step 4: Uploading transcoded video...');
    
    const transcodedObjectName = `${videoId}/${outputFilename}`;
    await minioClient.fPutObject(
      'transcoded-videos',
      transcodedObjectName,
      outputPath,
      { 'Content-Type': 'video/mp4' }
    );
    
    const outputUrl = `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/transcoded-videos/${transcodedObjectName}`;
    console.log(`✅ Uploaded: ${outputUrl}`);
    
    job.progress(95);
    
    // Step 5: Update database
    console.log('💾 Step 5: Updating database...');
    await updateJobStatus(
      videoId,
      RESOLUTION,
      'completed',
      WORKER_ID,
      outputUrl,
      result.size
    );
    
    job.progress(100);
    
    // Cleanup
    [inputPath, outputPath].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    
    console.log(`\n✅ Job ${job.id} completed successfully!\n`);
    
    done(null, {
      videoId,
      resolution: RESOLUTION,
      outputUrl,
      size: result.size,
      duration: result.duration
    });
    
  } catch (error) {
    console.error(`\n❌ Job ${job.id} failed:`, error.message);
    
    // Update database with error
    await updateJobStatus(
      videoId,
      RESOLUTION,
      'failed',
      WORKER_ID,
      null,
      null,
      error.message
    );
    
    // Cleanup on error
    [inputPath, outputPath].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    
    done(error);
  }
});

// Update job status in database
async function updateJobStatus(
  videoId,
  resolution,
  status,
  workerId = null,
  outputPath = null,
  outputSize = null,
  errorMessage = null
) {
  const client = await pool.connect();
  try {
    let query;
    let params;
    
    if (status === 'processing') {
      query = `UPDATE transcoding_jobs 
               SET status = $1, worker_id = $2, started_at = NOW()
               WHERE video_id = $3 AND resolution = $4`;
      params = [status, workerId, videoId, resolution];
    } else if (status === 'completed') {
      query = `UPDATE transcoding_jobs 
               SET status = $1, output_path = $2, output_size = $3, completed_at = NOW()
               WHERE video_id = $4 AND resolution = $5`;
      params = [status, outputPath, outputSize, videoId, resolution];
    } else if (status === 'failed') {
      query = `UPDATE transcoding_jobs 
               SET status = $1, error_message = $2, completed_at = NOW()
               WHERE video_id = $3 AND resolution = $4`;
      params = [status, errorMessage, videoId, resolution];
    }
    
    await client.query(query, params);
  } finally {
    client.release();
  }
}

// Queue event listeners
queue.on('completed', (job, result) => {
  console.log(`✅ Queue: Job ${job.id} completed`);
});

queue.on('failed', (job, err) => {
  console.error(`❌ Queue: Job ${job.id} failed:`, err.message);
});

queue.on('active', (job) => {
  console.log(`🔄 Queue: Job ${job.id} started`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM received, closing worker...');
  await queue.close();
  await pool.end();
  process.exit(0);
});

console.log(`✅ Worker ${WORKER_ID} is ready and waiting for jobs...`);
console.log(`📊 Queue: transcoding-${RESOLUTION}`);
console.log(`🔗 Redis: ${redisConfig.redis.host}:${redisConfig.redis.port}`);