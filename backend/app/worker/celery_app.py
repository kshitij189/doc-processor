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
