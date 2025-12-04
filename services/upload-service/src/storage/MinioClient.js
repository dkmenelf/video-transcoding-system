const Minio = require('minio');
const fs = require('fs');
const path = require('path');

class MinioStorage {
  constructor() {
    this.client = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123'
    });
    
    this.buckets = {
      original: 'original-videos',
      transcoded: 'transcoded-videos'
    };
    
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    try {
      console.log('🔧 Initializing MinIO buckets...');
      
      for (const bucketName of Object.values(this.buckets)) {
        const exists = await this.client.bucketExists(bucketName);
        
        if (!exists) {
          await this.client.makeBucket(bucketName, 'us-east-1');
          console.log(`✅ Created bucket: ${bucketName}`);
          
          
          if (bucketName === this.buckets.transcoded) {
            const policy = {
              Version: '2012-10-17',
              Statement: [{
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucketName}/*`]
              }]
            };
            await this.client.setBucketPolicy(bucketName, JSON.stringify(policy));
          }
        } else {
          console.log(`✓ Bucket already exists: ${bucketName}`);
        }
      }
      
      this.initialized = true;
      console.log('✅ MinIO initialization complete');
    } catch (error) {
      console.error('❌ MinIO initialization error:', error);
      throw error;
    }
  }
  
  async uploadFile(filePath, objectName, bucket = 'original') {
    await this.initialize();
    
    const bucketName = this.buckets[bucket];
    const metaData = {
      'Content-Type': 'video/mp4',
      'X-Upload-Date': new Date().toISOString()
    };
    
    try {
      const stats = fs.statSync(filePath);
      await this.client.fPutObject(bucketName, objectName, filePath, metaData);
      
      console.log(`✅ Uploaded: ${objectName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      
      return {
        bucket: bucketName,
        objectName,
        size: stats.size,
        url: `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${bucketName}/${objectName}`
      };
    } catch (error) {
      console.error(`❌ Upload error for ${objectName}:`, error);
      throw error;
    }
  }
  
  async downloadFile(objectName, destination, bucket = 'original') {
    await this.initialize();
    
    const bucketName = this.buckets[bucket];
    
    try {
      await this.client.fGetObject(bucketName, objectName, destination);
      console.log(`✅ Downloaded: ${objectName}`);
      return destination;
    } catch (error) {
      console.error(`❌ Download error for ${objectName}:`, error);
      throw error;
    }
  }
  
  getFileUrl(objectName, bucket = 'transcoded') {
    const bucketName = this.buckets[bucket];
    return `http://${process.env.MINIO_ENDPOINT}:${process.env.MINIO_PORT}/${bucketName}/${objectName}`;
  }
  
  async listFiles(bucket = 'original', prefix = '') {
    await this.initialize();
    
    const bucketName = this.buckets[bucket];
    const stream = this.client.listObjects(bucketName, prefix, true);
    const files = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', obj => files.push(obj));
      stream.on('error', reject);
      stream.on('end', () => resolve(files));
    });
  }
}

module.exports = new MinioStorage();