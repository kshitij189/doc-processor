#!/bin/bash
# Prevent PyTorch from spinning up excessive threads that thrash CPU limits
export OMP_NUM_THREADS=1

# Start Redis as the Celery broker inside this container. Persistence is off:
# this is a task queue, not a datastore, so snapshots would only cost memory
# (fork-on-save doubles RSS) and disk on an ephemeral filesystem.
# maxmemory caps it well below the 512MB instance limit. volatile-lru evicts
# only keys that carry a TTL — that is the 7-day embedding cache written by
# rag_service, never the queued Celery messages, which have no expiry. So a full
# cache degrades into recomputing embeddings rather than dropping tasks or (as
# noeviction would) refusing new ones and breaking uploads again.
redis-server \
    --daemonize yes \
    --save '' \
    --appendonly no \
    --maxmemory 64mb \
    --maxmemory-policy volatile-lru \
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
