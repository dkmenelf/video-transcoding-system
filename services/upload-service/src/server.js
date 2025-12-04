require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');

const { pool, initDatabase } = require('./database/init');
const minioStorage = require('./storage/MinioClient');
const queueManager = require('./queue/queueManager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());


const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 500 * 1024 * 1024 
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});


const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('🔌 New WebSocket client connected. Total:', clients.size);
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('🔌 Client disconnected. Total:', clients.size);
  });
});

function broadcastNotification(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}


app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'upload-service', timestamp: new Date() });
});


app.post('/api/upload', upload.single('video'), async (req, res) => {
  const videoId = uuidv4();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    console.log(`📹 Processing upload: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    const objectName = `${videoId}/${req.file.originalname}`;
    const uploadResult = await minioStorage.uploadFile(
      req.file.path,
      objectName,
      'original'
    );
    
    
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO videos (id, original_filename, original_size, status, storage_path, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          videoId,
          req.file.originalname,
          req.file.size,
          'uploaded',
          uploadResult.url,
          JSON.stringify({
            mimetype: req.file.mimetype,
            uploadedAt: new Date().toISOString()
          })
        ]
      );
      
      
      const resolutions = ['360p', '720p', '1080p'];
      for (const resolution of resolutions) {
        await client.query(
          `INSERT INTO transcoding_jobs (id, video_id, resolution, status)
           VALUES ($1, $2, $3, $4)`,
          [uuidv4(), videoId, resolution, 'pending']
        );
      }
      
      console.log(`✅ Video metadata saved: ${videoId}`);
    } finally {
      client.release();
    }
    
    
    const jobs = await queueManager.addTranscodingJob(videoId, {
      originalFilename: req.file.originalname,
      storagePath: uploadResult.url,
      objectName
    });
    
    
    fs.unlinkSync(req.file.path);
    
    
    broadcastNotification({
      type: 'upload_complete',
      videoId,
      filename: req.file.originalname,
      jobs
    });
    
    res.json({
      success: true,
      videoId,
      filename: req.file.originalname,
      size: req.file.size,
      jobs,
      message: 'Video uploaded successfully. Transcoding started.'
    });
    
  } catch (error) {
    console.error('❌ Upload error:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      error: 'Upload failed',
      message: error.message
    });
  }
});


app.get('/api/videos/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    const client = await pool.connect();
    try {
      
      const videoResult = await client.query(
        'SELECT * FROM videos WHERE id = $1',
        [videoId]
      );
      
      if (videoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Video not found' });
      }
      
      
      const jobsResult = await client.query(
        'SELECT * FROM transcoding_jobs WHERE video_id = $1 ORDER BY resolution',
        [videoId]
      );
      
      res.json({
        video: videoResult.rows[0],
        jobs: jobsResult.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error fetching video:', error);
    res.status(500).json({ error: 'Failed to fetch video information' });
  }
});

app.get('/api/videos', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT v.*, 
                COUNT(tj.id) as total_jobs,
                COUNT(CASE WHEN tj.status = 'completed' THEN 1 END) as completed_jobs
         FROM videos v
         LEFT JOIN transcoding_jobs tj ON v.id = tj.video_id
         GROUP BY v.id
         ORDER BY v.upload_date DESC
         LIMIT 50`
      );
      
      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error fetching videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const queueStats = await queueManager.getQueueStats();
    
    const client = await pool.connect();
    try {
      const dbStats = await client.query(`
        SELECT 
          status,
          COUNT(*) as count
        FROM videos
        GROUP BY status
      `);
      
      res.json({
        queues: queueStats,
        videos: dbStats.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

async function startServer() {
  try {
    console.log('🚀 Starting Upload Service...');
    
    
    await initDatabase();
    
    
    await minioStorage.initialize();
    
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`✅ Upload Service running on port ${PORT}`);
      console.log(`📊 WebSocket server ready`);
      console.log(`🔗 API: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}


process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM received, closing gracefully...');
  await queueManager.closeAll();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

startServer();