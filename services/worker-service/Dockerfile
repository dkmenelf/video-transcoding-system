FROM node:18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create working directories
RUN mkdir -p /tmp/transcoding/input /tmp/transcoding/output

CMD ["npm", "start"]