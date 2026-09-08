#!/bin/bash
# Prevent PyTorch from spinning up excessive threads that thrash CPU limits
export OMP_NUM_THREADS=1

# Start Redis as the Celery broker inside this container. Persistence is off:
# this is a task queue, not a datastore, so snapshots would only cost memory
# (fork-on-save doubles RSS) and disk on an ephemeral filesystem.
# maxmemory caps it well below the 512MB instance limit; noeviction means a full
# queue rejects new tasks instead of silently dropping queued ones.
redis-server \
    --daemonize yes \
    --save '' \
    --appendonly no \
    --maxmemory 64mb \
    --maxmemory-policy noeviction \
    --bind 127.0.0.1 \
    --port 6379

# Wait for Redis to accept connections before starting anything that publishes
# to it, so the worker doesn't die on a startup connection error.
for i in $(seq 1 30); do
    if redis-cli ping > /dev/null 2>&1; then
        echo "Redis is ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "WARNING: Redis did not become ready in 15s; continuing anyway"
    fi
    sleep 0.5
done

# Start Celery worker in the background with lowest CPU priority (nice -n 19)
# This ensures API requests (Uvicorn) stay fast even during heavy PyTorch embeddings
nice -n 19 celery -A app.worker.celery_app worker --loglevel=info --concurrency=1 &

# Start Uvicorn API server in the foreground
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
