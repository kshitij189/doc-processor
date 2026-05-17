# 🚀 DocProcessor Production Deployment Guide

This guide details the step-by-step instructions to take the **DocProcessor** platform from a local development workspace into a production-ready environment.

---

## 🏗️ Production Tech Stack & Hosting Options

Because DocProcessor is built with a distributed, multi-service architecture (React + FastAPI + Celery + PostgreSQL + Redis + ChromaDB + Tesseract OCR), you have two primary deployment patterns:

### Option A: Unified VPS Deployment (Recommended for MVP / Portfolios)
Deploy the entire stack onto a single Virtual Private Server (VPS) using our production-ready `docker-compose.prod.yml` configuration. This is the **most cost-effective** option ($5 to $10/month) and preserves data consistency across databases, volumes, and OCR processing.
*   **Recommended Providers:** DigitalOcean Droplet, Hetzner, AWS EC2, Linode, or Vultr.

### Option B: Distributed Cloud Architecture (Recommended for Enterprise / Scalability)
Deploy each service independently to dedicated PaaS or Serverless platforms for high availability, automatic scaling, and managed databases.
*   **Frontend (Static Web App):** Vercel, Netlify, or AWS S3 + CloudFront (Free / $1-2/month).
*   **FastAPI Backend (Containers):** Render Web Services, Railway, Fly.io, or AWS ECS ($7-15/month).
*   **Celery Worker (Background Worker):** Render Background Worker, Railway Private Services ($7-15/month).
*   **Managed Database (PostgreSQL):** Supabase (free tier), Render PostgreSQL, AWS RDS.
*   **Cache & Message Broker (Redis):** Upstash (serverless/free tier), Redis Labs.
*   **Vector Database (ChromaDB):** Chroma Cloud, or hosted as a standalone Docker container.

---

## 💻 Option A: Step-by-Step VPS Deployment (Self-Hosted Docker)

This is the easiest and most robust method. Since Docker handles all dependencies (including compiling Python bindings, system-level Tesseract OCR, and Nginx proxying), you can deploy with a single command.

### 1. Provision a VPS
*   **OS:** Ubuntu 22.04 LTS or newer
*   **Size:** Minimum 2GB RAM / 1 vCPU (required to comfortably run the sentence-transformer embeddings and Tesseract OCR concurrently)

### 2. Install Docker & Docker Compose
SSH into your VPS and install Docker:
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
```

### 3. Clone and Configure the Application
```bash
# Clone the repository
git clone https://github.com/kshitij189/doc-processor.git
cd doc-processor

# Create the environment configuration file
nano .env
```

Add your production keys and configuration to the `.env` file:
```env
OPENROUTER_API_KEY=your-production-openrouter-key
JWT_SECRET=generate-a-strong-random-32-character-string
```

### 4. Deploy in Production Mode
Start the production stack. Docker will build the optimized multi-stage React frontend (served via Nginx) and configure the multiple workers for FastAPI:
```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Verify all containers are active:
```bash
docker compose -f docker-compose.prod.yml ps
```

*   Your frontend will be accessible on port **80** (`http://your-server-ip`).
*   Your API docs will be available on port **8000** (`http://your-server-ip:8000/docs`).

### 5. Setup SSL (HTTPS) with Let's Encrypt
To secure the application with SSL, install Certbot and configure Nginx:
```bash
sudo apt-get install -y certbot
# Stop docker temporarily to free port 80 for SSL issuance
docker compose -f docker-compose.prod.yml down

# Run Certbot standalone
sudo certbot certonly --standalone -d yourdomain.com

# Start containers back up
docker compose -f docker-compose.prod.yml up -d
```
Update `/etc/nginx` or configure a reverse-proxy like Caddy or Nginx directly on the host to route incoming HTTPS requests to the Docker container on port 80.

---

## ☁️ Option B: Distributed PaaS/Serverless Deployment

If you prefer managed services to avoid managing Linux servers, follow this split architecture model:

### 1. PostgreSQL & Redis (Databases)
*   **PostgreSQL:** Spin up a managed instance on **Supabase** or **Neon.tech**. Copy the connection string.
*   **Redis:** Spin up a Serverless Redis instance on **Upstash** (free/cheap tier). Retrieve the connection URL (`rediss://...`).

### 2. FastAPI API & Celery Worker
Deploy using **Railway** or **Render** because they natively support Dockerfiles.

#### A. Deploy the API Backend:
*   Create a new service pointing to the `backend/` folder.
*   Configure the deployment to use the `Dockerfile.prod`.
*   Expose port `8000`.
*   Set the following Environment Variables:
    ```env
    DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>:5432/<db_name>?ssl=require
    DATABASE_URL_SYNC=postgresql://<user>:<password>@<host>:5432/<db_name>?ssl=require
    REDIS_URL=rediss://default:<password>@<upstash-endpoint>:6379/0
    CELERY_BROKER_URL=rediss://default:<password>@<upstash-endpoint>:6379/0
    CELERY_RESULT_BACKEND=rediss://default:<password>@<upstash-endpoint>:6379/1
    OPENROUTER_API_KEY=your-api-key
    CHROMA_DIR=/app/chromadb_data
    UPLOAD_DIR=/app/uploads
    ```

#### B. Deploy the Celery Worker:
*   Create a second service (Render "Background Worker" or Railway "Private Service") pointing to the same `backend/` folder.
*   Use the same `Dockerfile.prod` and environment variables.
*   Set the start command override:
    ```bash
    celery -A app.worker.celery_app worker --loglevel=info --concurrency=2
    ```

### 3. React Frontend (Static Web App)
You can deploy the React frontend directly to **Vercel** or **Netlify**:
*   **Build Command:** `npm run build`
*   **Output Directory:** `dist`
*   Configure the build variables to route API requests. In `vite.config.ts`, standard API requests use `/api`. If you deploy the frontend and backend on different domains (e.g., `docprocessor.vercel.app` and `api.docprocessor.com`), update `frontend/src/api/client.ts` to point `API_BASE` directly to your production API URL:
    ```typescript
    const API_BASE = 'https://api.docprocessor.com/api';
    ```

---

## 🛠️ OCR Production System Requirements

*   **Tesseract OCR:** In a native deployment (non-Docker), Tesseract must be installed on the host system:
    *   **Ubuntu/Debian:** `sudo apt-get install tesseract-ocr`
    *   **MacOS:** `brew install tesseract`
    *   **Windows:** Install binaries and add the installation folder to the system `PATH`.
*   In our Docker containers, this is fully pre-configured within the base layers of `Dockerfile.prod` to ensure seamless zero-configuration OCR.

---

## 🔒 Post-Deployment Security Checklists

1.  **Change Default Credentials:** Make sure `POSTGRES_PASSWORD` is generated randomly in production rather than utilizing `postgres` default.
2.  **CORS Settings:** Restrict the backend's allowed origins (`CORS_ORIGINS`) to only your frontend's production domain rather than `["*"]`.
3.  **Storage Volume Backups:** Set up automated hourly/daily backups for the PostgreSQL Docker volume `pgdata` and document storage `uploads` to secure user uploads and metadata.
