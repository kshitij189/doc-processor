import os
from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/docprocessor",
    )
    DATABASE_URL_SYNC: str = os.getenv(
        "DATABASE_URL_SYNC",
        "postgresql://postgres:postgres@localhost:5432/docprocessor",
    )

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def clean_database_url(cls, v) -> str:
        if isinstance(v, str):
            from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
            parsed = urlparse(v)
            params = dict(parse_qsl(parsed.query))
            
            # Convert sslmode to ssl for asyncpg compatibility
            if "sslmode" in params:
                params["ssl"] = params.pop("sslmode")
            elif "neon.tech" in parsed.netloc and "ssl" not in params:
                params["ssl"] = "require"
                
            # Strip unsupported parameters (like channel_binding) from asyncpg connections
            params.pop("channel_binding", None)
            
            new_query = urlencode(params)
            v = urlunparse((
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                new_query,
                parsed.fragment
            ))
        return v

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # Celery
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    CELERY_RESULT_BACKEND: str = os.getenv(
        "CELERY_RESULT_BACKEND", "redis://localhost:6379/1"
    )

    @field_validator("REDIS_URL", "CELERY_BROKER_URL", "CELERY_RESULT_BACKEND", mode="before")
    @classmethod
    def clean_redis_url(cls, v) -> str:
        if isinstance(v, str) and v.startswith("rediss://"):
            from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
            parsed = urlparse(v)
            params = dict(parse_qsl(parsed.query))
            
            # Celery requires ssl_cert_reqs to be exactly CERT_NONE, CERT_REQUIRED, or CERT_OPTIONAL
            if "ssl_cert_reqs" not in params:
                params["ssl_cert_reqs"] = "CERT_NONE"
            elif params["ssl_cert_reqs"].lower() == "none":
                params["ssl_cert_reqs"] = "CERT_NONE"
                
            new_query = urlencode(params)
            v = urlunparse((
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parsed.params,
                new_query,
                parsed.fragment
            ))
        return v

    # File uploads
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "./uploads")
    MAX_FILE_SIZE: int = 50 * 1024 * 1024  # 50MB

    # CORS
    CORS_ORIGINS: list[str] | str = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v) -> list[str]:
        if isinstance(v, str):
            # If it's a JSON array string like '["*"]', load it as JSON
            if v.startswith("[") and v.endswith("]"):
                try:
                    import json
                    loaded = json.loads(v)
                    if isinstance(loaded, list):
                        return loaded
                except Exception:
                    pass
            # Otherwise, split by comma
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    # --- RAG Configuration ---
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    CHROMA_DIR: str = os.getenv("CHROMA_DIR", "./chromadb_data")
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    RERANKER_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    MAX_CONTEXT_TOKENS: int = 4000
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50

    # --- Auth / JWT ---
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "docprocessor-super-secret-key-change-in-production")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 24

    class Config:
        env_file = ".env"


settings = Settings()
