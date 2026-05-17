# ☁️ 100% Free Production Deployment Guide on Render, Neon, & Upstash

This guide details the exact step-by-step instructions to deploy the entire **DocProcessor** stack (Frontend, Backend, Background Celery Worker, Vector Store, PostgreSQL, Redis, and Tesseract OCR) **completely for free** using managed cloud platforms.

---

## 🏗️ The 100% Free Tech Stack Architecture

Since Render's free tier does not support separate "Background Workers" (which are paid services starting at $7/month), we will use an engineering trick: **running both the FastAPI API server and the Celery worker inside the same single Render Web Service container.** 

Here is where each component will be hosted:
1.  **Frontend:** Render Static Site (Free, optimized CDN, SSL automatically included).
2.  **API Backend + Celery Worker:** Render Web Service (Free tier, uses `Dockerfile.render` to run both services together).
3.  **Tesseract OCR:** Pre-installed automatically for free inside the Render Docker container.
4.  **Relational DB (PostgreSQL):** Neon Serverless Postgres (Free tier, highly performant).
5.  **Task Broker & Cache (Redis):** Upstash Serverless Redis (Free tier, robust SSL/TLS connections).
6.  **Vector DB (ChromaDB):** Persistent storage inside the Render Docker container.

---

## 🛠️ Step-by-Step Deployment Instructions

### Step 1: Set Up Upstash Redis (Free)
1.  Go to [Upstash Console](https://console.upstash.com/) and create a free account.
2.  Click **Create Database**.
3.  Select a region close to your target users and set the database name to `docprocessor-redis`.
4.  Copy the **Redis Connection URL** starting with `rediss://` (the double `s` is critical as it enforces encrypted TLS connections in production).
    *   *Example:* `rediss://default:abc123xyz...@your-db.upstash.io:6379`

### Step 2: Set Up Neon PostgreSQL (Free)
1.  Go to [Neon Console](https://neon.tech/) and create a free account.
2.  Create a new project named `docprocessor-db`.
3.  Choose PostgreSQL version `16` and select the same region as your Redis database.
4.  Copy the connection string from the dashboard.
5.  **Important:** You need to save **two variations** of the connection string in your notes:
    *   **Synchronous URL (for Celery):** `postgresql://alex:password@ep-cool-breeze.neon.tech/neondb?sslmode=require`
    *   **Asynchronous URL (for FastAPI AsyncPG):** Replace the prefix `postgresql://` with `postgresql+asyncpg://`.
        *   *Example:* `postgresql+asyncpg://alex:password@ep-cool-breeze.neon.tech/neondb?sslmode=require`

### Step 3: Deploy Backend on Render (Free Web Service)
1.  Go to [Render Dashboard](https://dashboard.render.com/) and log in.
2.  Click **New +** and select **Web Service**.
3.  Connect your GitHub repository: `https://github.com/kshitij189/doc-processor.git`.
4.  Configure the service details:
    *   **Name:** `docprocessor-api`
    *   **Language:** `Docker`
    *   **Branch:** `main`
    *   **Docker Tool:** Leave default
    *   **Docker Path:** `backend/Dockerfile.render` *(Crucial: This points to our custom free-tier file that starts both FastAPI and Celery)*
    *   **Instance Type:** `Free` ($0/month)
5.  Scroll down and click **Advanced** -> **Add Environment Variable**. Add these exact keys:
    *   `DATABASE_URL` = *Your Asynchronous Neon String (`postgresql+asyncpg://...`)*
    *   `DATABASE_URL_SYNC` = *Your Synchronous Neon String (`postgresql://...`)*
    *   `REDIS_URL` = *Your Upstash URL (`rediss://...`)*
    *   `CELERY_BROKER_URL` = *Your Upstash URL (`rediss://...`)*
    *   `CELERY_RESULT_BACKEND` = *Your Upstash URL (`rediss://...`)*
    *   `OPENROUTER_API_KEY` = *Your OpenRouter API key*
    *   `JWT_SECRET_KEY` = *A strong random 32-character text string*
    *   `CORS_ORIGINS` = `*` *(Or later your frontend Render Static Site URL for extra security)*
    *   `UPLOAD_DIR` = `/app/uploads`
    *   `CHROMA_DIR` = `/app/chromadb_data`
6.  Click **Create Web Service**. 
    *   *Note: Render will automatically download PyTorch (CPU-optimized) and install Tesseract OCR for you completely for free!*

### Step 4: Deploy Frontend on Render (Free Static Site)
1.  On the Render Dashboard, click **New +** and select **Static Site**.
2.  Connect your GitHub repository.
3.  Configure the service details:
    *   **Name:** `doc-processor`
    *   **Branch:** `main`
    *   **Build Command:** `npm run build`
    *   **Publish Directory:** `dist`
4.  Under the service settings, select the **Redirects/Rewrites** tab.
5.  Click **Add Rule** to route frontend requests cleanly to your backend:
    *   **Source:** `/api/*`
    *   **Destination:** `https://docprocessor-api.onrender.com/api/*` *(Replace with your exact Render backend URL)*
    *   **Action:** `Rewrite` *(This acts as a transparent proxy and prevents CORS issues entirely!)*
6.  Click **Create Static Site**.

---

## 🛠️ The Tesseract OCR & Docker Setup

*   **Best Tesseract Option:** Because you run your whole project through Docker, **the container takes care of Tesseract OCR entirely.** You do not need to install Tesseract on your personal machine or look for external OCR hosting. 
*   Our `backend/Dockerfile.render` has the line `RUN apt-get update && apt-get install -y tesseract-ocr`. When Render builds your container, it automatically downloads and configures Tesseract OCR, PyMuPDF, and PIL. It is completely free, 100% self-contained, and requires zero manual setup.

---

## 🔒 Production Verification & Scaling

1.  **Cold Start:** Since Render's Web Service is on the free tier, it will go to "sleep" after 15 minutes of inactivity. The first request after a period of sleep might take 30-50 seconds to spin back up (a normal behavior of free container hosting).
2.  **Celery Concurrency:** Our `backend/start.sh` script starts Celery with `--concurrency=1` to limit memory consumption so it runs stably inside Render's free 512MB RAM container.
3.  **Local vs Production Development:** Since you develop purely using Docker locally, your local setup remains untouched and perfectly functional. In production, Neon and Upstash replace your local PostgreSQL and Redis containers, while Render replaces your API, Celery, and Nginx containers.
