import ssl
from celery import Celery

from app.config import settings

celery_app = Celery(
    "docprocessor",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_config = {
    "task_serializer": "json",
    "accept_content": ["json"],
    "result_serializer": "json",
    "timezone": "UTC",
    "enable_utc": True,
    "task_track_started": True,
    "task_acks_late": True,
    "worker_prefetch_multiplier": 1,
    "task_reject_on_worker_lost": True,
    "broker_connection_retry_on_startup": True,
    # Bound every task so a stall (a hung model download, a pathological PDF)
    # surfaces as a failure the user can retry instead of a job that sits at
    # partial progress forever. The soft limit raises inside the task so the
    # pipeline's own handler marks the document failed; the hard limit is the
    # backstop if that handler is itself stuck.
    "task_soft_time_limit": 600,
    "task_time_limit": 660,
    # Fail fast when the broker is unreachable instead of hanging the HTTP
    # request that is publishing the task.
    "broker_transport_options": {
        "socket_connect_timeout": 5,
        "socket_timeout": 5,
    },
    "broker_connection_timeout": 5,
    "task_publish_retry_policy": {
        "max_retries": 1,
        "interval_start": 0,
        "interval_step": 0.5,
        "interval_max": 1,
    },
}

# If using secure Redis in production (rediss://), inject standard TLS config
if settings.REDIS_URL.startswith("rediss://"):
    celery_config["broker_use_ssl"] = {
        "ssl_cert_reqs": ssl.CERT_NONE
    }
    celery_config["redis_backend_use_ssl"] = {
        "ssl_cert_reqs": ssl.CERT_NONE
    }

celery_app.conf.update(celery_config)

celery_app.autodiscover_tasks(["app.worker"])
