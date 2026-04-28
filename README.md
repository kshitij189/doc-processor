# DocProcessor — Async Document Processing Workflow System

A production-grade full-stack application for uploading, processing, reviewing, editing, and exporting documents through an asynchronous workflow pipeline.

## Architecture

```
┌─────────────────┐       ┌──────────────────┐       ┌──────────────┐
│  React Frontend │──REST──│  FastAPI Backend  │──ORM──│  PostgreSQL  │
│  (Vite + TS)    │       │                  │       │              │
└────────┬────────┘       └───────┬──────────┘       └──────────────┘
         │ SSE                    │
         │                        │ Celery Task
         │                        ▼
         │               ┌──────────────────┐
         └───SSE─────────│  Redis           │
                         │  (Broker + PubSub)│
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │  Celery Worker   │
                         │  (Processing)    │
                         └──────────────────┘
```

**Tech Stack:**
| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Python 3.12 + FastAPI |
| Database | PostgreSQL 16 |
| Task Queue | Celery |
| Message Broker | Redis 7 |
| Progress Events | Redis Pub/Sub → SSE |
| Containerization | Docker Compose |

## Features

- **Multi-file upload** with drag-and-drop support
- **Async processing pipeline** via Celery workers
- **Real-time progress tracking** via Redis Pub/Sub + Server-Sent Events
- **Dashboard** with search, filter by status, sorting, and pagination
- **Document detail view** with extracted result review and editing
- **Finalization workflow** — lock edits after review
- **Export** finalized records as JSON or CSV (single + bulk)
- **Retry** failed jobs with exponential backoff
- **Docker Compose** for one-command deployment

## Processing Pipeline

Each document goes through these stages (published as SSE events):

1. `job_started` → status = processing
2. `document_parsing_started` → text extraction
3. `document_parsing_completed` → raw text ready
4. `field_extraction_started` → NLP extraction
5. `field_extraction_completed` → structured fields ready
6. `storing_result` → persist to database
7. `job_completed` → status = completed

**Extracted Fields:** title, category, summary, keywords, metadata (word count, char count, line count)

## Setup & Run

### Prerequisites
- Docker & Docker Compose installed

### Quick Start

```bash
# Clone the repository
git clone <repo-url>
cd docprocessor

# Start all services
docker-compose up --build

# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### Local Development (without Docker)

**Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Start PostgreSQL and Redis locally, then:
uvicorn app.main:app --reload --port 8000

# In a separate terminal:
celery -A app.worker.celery_app worker --loglevel=info
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/documents/upload` | Upload one or more files |
| `GET` | `/api/documents` | List documents (search, filter, sort, paginate) |
| `GET` | `/api/documents/{id}` | Get document with processing result |
| `POST` | `/api/documents/{id}/retry` | Retry a failed job |
| `PUT` | `/api/documents/{id}/result` | Edit extracted result |
| `POST` | `/api/documents/{id}/finalize` | Finalize reviewed result |
| `GET` | `/api/documents/{id}/export?format=json|csv` | Export single document |
| `GET` | `/api/documents/export/bulk?format=json|csv` | Bulk export |
| `GET` | `/api/progress/{document_id}` | SSE progress stream |
| `GET` | `/api/health` | Health check |

## Database Schema

**documents** — File metadata, status tracking, Celery task reference
**processing_results** — Extracted fields (title, category, summary, keywords, metadata, raw_text)

## Sample Files

The `sample_files/` directory contains test documents:
- `financial_report.txt` — Categorized as "Financial"
- `software_license.txt` — Categorized as "Legal"
- `research_paper.txt` — Categorized as "Report"
- `resume_sample.txt` — Categorized as "Resume"

## Design Decisions & Tradeoffs

1. **SSE over WebSocket** — Simpler for unidirectional server→client progress streaming, built-in browser reconnection, works through HTTP proxies
2. **Redis Pub/Sub + Hash fallback** — Pub/Sub for real-time, Redis hash stores latest status so late-joining clients see current progress immediately
3. **Synchronous Celery worker** — Celery runs sync Python; SQLAlchemy sync sessions used in workers while FastAPI uses async sessions
4. **File-based storage** — Files stored on shared Docker volume; in production, swap for S3/GCS via storage abstraction layer
5. **Simulated NLP** — Processing logic uses heuristic keyword matching and frequency analysis rather than ML models; system architecture is the focus
6. **Auto-table creation** — Tables created on FastAPI startup via `Base.metadata.create_all`; in production, use Alembic migrations

## Limitations

- No authentication/authorization (would add JWT in production)
- File storage is local (not object storage)
- NLP extraction is heuristic, not ML-based
- No WebSocket fallback if SSE is blocked
- Single Celery worker (horizontally scalable with Docker)
- No rate limiting on upload endpoint

## Assumptions

- PostgreSQL and Redis are available (provided via Docker Compose)
- Files are reasonable in size (< 50MB each)
- Processing is CPU-bound simulation (not actual OCR/ML)
- Single-tenant system (no multi-user isolation)
