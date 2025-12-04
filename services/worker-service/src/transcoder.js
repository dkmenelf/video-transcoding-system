const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

class VideoTranscoder {
  constructor() {
    // Resolution configurations
    this.configs = {
      '360p': {
        resolution: '640x360',
        videoBitrate: '800k',
        audioBitrate: '96k'
      },
      '720p': {
        resolution: '1280x720',
        videoBitrate: '2500k',
        audioBitrate: '128k'
      },
      '1080p': {
        resolution: '1920x1080',
        videoBitrate: '5000k',
        audioBitrate: '192k'
      }
    };
  }
  
  async transcode(inputPath, outputPath, resolution, onProgress) {
    return new Promise((resolve, reject) => {
      const config = this.configs[resolution];
      
      if (!config) {
        return reject(new Error(`Unknown resolution: ${resolution}`));
      }
      
      console.log(`🎬 Starting transcoding to ${resolution}...`);
      console.log(`   Input: ${inputPath}`);
      console.log(`   Output: ${outputPath}`);
      
      const startTime = Date.now();
      
      ffmpeg(inputPath)
        .outputOptions([
          `-vf scale=${config.resolution}`,
          `-c:v libx264`,
          `-preset medium`,
          `-b:v ${config.videoBitrate}`,
          `-c:a aac`,
          `-b:a ${config.audioBitrate}`,
          `-movflags +faststart`
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`📝 FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (onProgress) {
            onProgress({
              percent: progress.percent || 0,
              currentFps: progress.currentFps,
              currentKbps: progress.currentKbps,
              targetSize: progress.targetSize,
              timemark: progress.timemark
            });
          }
          
          if (progress.percent) {
            console.log(`⏳ Progress: ${progress.percent.toFixed(2)}% (${progress.timemark})`);
          }
        })
        .on('end', () => {
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          const stats = fs.statSync(outputPath);
          const size = (stats.size / 1024 / 1024).toFixed(2);
          
          console.log(`✅ Transcoding complete! (${duration}s, ${size}MB)`);
          
          resolve({
            duration: parseFloat(duration),
            size: stats.size,
            path: outputPath
          });
        })
        .on('error', (err) => {
          console.error(`❌ Transcoding error:`, err.message);
          reject(err);
        })
        .run();
    });
  }
  
  async getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          return reject(err);
        }
        
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        
        resolve({
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          video: videoStream ? {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            fps: eval(videoStream.r_frame_rate)
          } : null,
          audio: audioStream ? {
            codec: audioStream.codec_name,
            sampleRate: audioStream.sample_rate,
            channels: audioStream.channels
          } : null
        });
      });
    });
  }
  
  async createHLSPlaylist(inputFiles, outputDir, videoId) {
    // HLS (HTTP Live Streaming) playlist creation
    // This creates a master playlist that switches between qualities
    
    const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
${videoId}_360p.mp4

#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
${videoId}_720p.mp4

#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
${videoId}_1080p.mp4
`;
    
    const playlistPath = path.join(outputDir, `${videoId}_master.m3u8`);
    fs.writeFileSync(playlistPath, masterPlaylist);
    
    console.log(`📝 Created HLS master playlist: ${playlistPath}`);
    
    return playlistPath;
  }
}

module.exports = new VideoTranscoder();