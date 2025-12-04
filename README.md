# Distributed Video Transcoding Pipeline

![Status](https://img.shields.io/badge/build-passing-brightgreen)
![Architecture](https://img.shields.io/badge/architecture-microservices-blue)
![Docker](https://img.shields.io/badge/containerized-true-blue)

A high-throughput, fault-tolerant video processing architecture designed to handle large-scale media ingestion and transcoding. This project demonstrates **event-driven microservices**, **asynchronous task orchestration**, and **distributed system patterns**.

## System Architecture

The system utilizes a producer-consumer pattern to decouple upload ingestion from CPU-intensive transcoding tasks.

```mermaid
graph LR
    Client -->|POST /upload| API[Ingestion Service]
    API -->|Raw File| Storage[(MinIO S3)]
    API -->|Job Event| Queue[Redis Message Broker]
    
    subgraph "Worker Cluster"
    Queue -->|Consume| W1[Worker: 360p]
    Queue -->|Consume| W2[Worker: 720p]
    Queue -->|Consume| W3[Worker: 1080p]
    end
    
    %% Parantezleri kaldırdım, artık hata vermez
    W1 & W2 & W3 -->|Process via FFmpeg| Storage
    W1 & W2 & W3 -.->|Pub/Sub| WebSocket[Notification Svc]
    WebSocket -.->|Real-time Status| Client

Harika. İşe alım uzmanlarının ve teknik liderlerin vakti kısıtlıdır. Uzun metinler yerine teknik yetkinliği vurgulayan, temiz ve "senior" bir mühendis dili kullanan versiyon aşağıdadır.Bunu direkt README.md dosyana yapıştırabilirsin.Markdown# Distributed Video Transcoding Pipeline

![Status](https://img.shields.io/badge/build-passing-brightgreen)
![Architecture](https://img.shields.io/badge/architecture-microservices-blue)
![Docker](https://img.shields.io/badge/containerized-true-blue)

A high-throughput, fault-tolerant video processing architecture designed to handle large-scale media ingestion and transcoding. This project demonstrates **event-driven microservices**, **asynchronous task orchestration**, and **distributed system patterns**.

## 🏗 System Architecture

The system utilizes a producer-consumer pattern to decouple upload ingestion from CPU-intensive transcoding tasks.

```mermaid
graph LR
    Client -->|POST /upload| API[Ingestion Service]
    API -->|Raw File| Storage[(MinIO S3)]
    API -->|Job Event| Queue[Redis Message Broker]
    
    subgraph "Worker Cluster"
    Queue -->|Consume| W1[Worker: 360p]
    Queue -->|Consume| W2[Worker: 720p]
    Queue -->|Consume| W3[Worker: 1080p]
    end
    
    W1 & W2 & W3 -->|Process (FFmpeg)| Storage
    W1 & W2 & W3 -.->|Pub/Sub| WebSocket[Notification Svc]
    WebSocket -.->|Real-time Status| Client
Technology Stack
Core- Node.js, Express
Media Processing - FFmpeg
Infrastructure - Docker, Docker Compose
Data & Messaging - PostgreSQL, Redis, MinIO
Protocols - HTTP/REST, WebSockets

1. Clone Repository
git clone [https://github.com/YOUR_USERNAME/distributed-video-transcoder.git](https://github.com/YOUR_USERNAME/distributed-video-transcoder.git)

# 2. Configure Environment
cp .env.example .env

# 3. Spin up Infrastructure (Database, Queue, S3, Services)
docker-compose up --build -d
API Endpoint: http://localhost:3000MinIO Console: http://localhost:9001

# 3. Spin up Infrastructure (Database, Queue, S3, Services)
docker-compose up --build -d
API Endpoint: http://localhost:3000
MinIO Console: http://localhost:9001
