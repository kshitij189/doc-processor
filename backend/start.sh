#!/bin/bash
# Prevent PyTorch from spinning up excessive threads that thrash CPU limits
export OMP_NUM_THREADS=1

# Start Celery worker in the background with lowest CPU priority (nice -n 19)
# This ensures API requests (Uvicorn) stay fast even during heavy PyTorch embeddings
nice -n 19 celery -A app.worker.celery_app worker --loglevel=info --concurrency=1 &

# Start Uvicorn API server in the foreground
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
