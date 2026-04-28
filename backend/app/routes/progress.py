"""
SSE endpoint for streaming real-time document processing progress
via Redis Pub/Sub.
"""

import asyncio
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.config import settings

router = APIRouter(prefix="/api/progress", tags=["Progress"])


async def progress_event_generator(request: Request, document_id: str):
    """
    Subscribe to Redis Pub/Sub channel for a document and yield SSE events.
    Also sends the last-known status immediately from Redis hash.
    """
    redis_client = aioredis.from_url(settings.REDIS_URL)
    pubsub = redis_client.pubsub()
    channel = f"doc_progress:{document_id}"

    try:
        # Send last-known status from Redis hash (for reconnection / late joins)
        cached_status = await redis_client.hgetall(f"doc_status:{document_id}")
        if cached_status:
            event_data = {
                k.decode(): v.decode() for k, v in cached_status.items()
            }
            event_data["document_id"] = document_id
            yield {
                "event": "progress",
                "data": json.dumps(event_data),
            }

        # Subscribe to live updates
        await pubsub.subscribe(channel)

        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")

                yield {
                    "event": "progress",
                    "data": data,
                }

                # If job completed or failed, close the stream
                try:
                    parsed = json.loads(data)
                    if parsed.get("stage") in ("job_completed", "job_failed"):
                        yield {
                            "event": "done",
                            "data": json.dumps({"status": "stream_ended"}),
                        }
                        break
                except json.JSONDecodeError:
                    pass

            # Small sleep to prevent busy loop
            await asyncio.sleep(0.1)

    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await redis_client.close()


@router.get("/{document_id}")
async def stream_progress(request: Request, document_id: str):
    """
    SSE endpoint: streams real-time processing progress for a document.
    
    Usage:
        const evtSource = new EventSource('/api/progress/{document_id}');
        evtSource.addEventListener('progress', (e) => { ... });
    """
    return EventSourceResponse(
        progress_event_generator(request, document_id),
        media_type="text/event-stream",
    )
