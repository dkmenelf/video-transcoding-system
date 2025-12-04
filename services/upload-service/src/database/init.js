const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://videouser:videopass@localhost:5432/videodb'
});

async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔨 Creating database schema...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id UUID PRIMARY KEY,
        original_filename VARCHAR(255) NOT NULL,
        original_size BIGINT NOT NULL,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'uploading',
        storage_path VARCHAR(500),
        duration FLOAT,
        metadata JSONB
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS transcoding_jobs (
        id UUID PRIMARY KEY,
        video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
        resolution VARCHAR(20) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        output_path VARCHAR(500),
        output_size BIGINT,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        error_message TEXT,
        worker_id VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON transcoding_jobs(video_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON transcoding_jobs(status);
    `);
    
    console.log('✅ Database schema created successfully!');
  } catch (error) {
    console.error('❌ Error creating schema:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('Database initialization complete');
      process.exit(0);
    })
    .catch(err => {
      console.error('Database initialization failed:', err);
      process.exit(1);
    });
}

module.exports = { pool, initDatabase };