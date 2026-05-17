#!/bin/bash
# Start Celery worker in the background (concurrency=1 to stay within Render's free 512MB RAM limit)
celery -A app.worker.celery_app worker --loglevel=info --concurrency=1 &

# Start Uvicorn API server in the foreground
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
