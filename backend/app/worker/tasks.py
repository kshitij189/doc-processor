"""
Celery task: process_document

Multi-stage pipeline that processes a document and publishes progress
events via Redis Pub/Sub at each stage.
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import redis
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models import Document, DocumentStatus, ProcessingResult
from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)

# Synchronous DB session for Celery worker (Celery is sync)
sync_engine = create_engine(
    settings.DATABASE_URL_SYNC, pool_pre_ping=True
)
SyncSession = sessionmaker(bind=sync_engine)

# Redis client for Pub/Sub publishing
redis_client = redis.Redis.from_url(settings.REDIS_URL)


def publish_progress(document_id: str, stage: str, progress: int, message: str):
    """Publish a progress event to Redis Pub/Sub."""
    event = {
        "document_id": document_id,
        "stage": stage,
        "progress": progress,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    channel = f"doc_progress:{document_id}"
    redis_client.publish(channel, json.dumps(event))
    # Also store latest progress in Redis hash for polling fallback
    redis_client.hset(f"doc_status:{document_id}", mapping={
        "stage": stage,
        "progress": str(progress),
        "message": message,
        "timestamp": event["timestamp"],
    })
    redis_client.expire(f"doc_status:{document_id}", 3600)  # TTL 1 hour


def extract_text_from_file(file_path: str, file_type: str) -> str:
    """Extract text content from uploaded file."""
    try:
        if file_type in ("text/plain", "text/csv", "text/markdown"):
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        elif file_type.startswith("image/"):
            try:
                import pytesseract
                from PIL import Image
                img = Image.open(file_path)
                text = pytesseract.image_to_string(img)
                return text
            except Exception as e:
                return f"[Image OCR failed: {str(e)}]"
        elif file_type == "application/pdf":
            try:
                import fitz
                import io

                doc = fitz.open(file_path)
                text_parts = []

                # Step 1: Extract all digital text from every page (fast — milliseconds)
                for page in doc:
                    page_text = page.get_text()
                    if page_text and page_text.strip():
                        text_parts.append(page_text)

                total_text = "\n".join(text_parts)

                # Step 2: Only run OCR if the PDF has very little/no digital text
                # (i.e., it's a scanned document). Skip OCR for normal digital PDFs
                # to avoid spending minutes on embedded logos/charts/photos.
                if len(total_text.strip()) < 200:
                    try:
                        import pytesseract
                        from PIL import Image
                        ocr_parts = []
                        for page in doc:
                            image_list = page.get_images(full=True)
                            for img_info in image_list:
                                try:
                                    xref = img_info[0]
                                    base_image = doc.extract_image(xref)
                                    img = Image.open(io.BytesIO(base_image["image"]))
                                    ocr_text = pytesseract.image_to_string(img)
                                    if ocr_text.strip():
                                        ocr_parts.append(ocr_text.strip())
                                except Exception:
                                    continue
                        if ocr_parts:
                            total_text = "\n".join(ocr_parts)
                    except Exception:
                        pass  # OCR not available — return whatever digital text we got

                return total_text
            except Exception as e:
                return f"[PDF parsing failed: {str(e)}]"
        elif file_type in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ):
            try:
                from docx import Document as DocxDocument
                doc = DocxDocument(file_path)
                return "\n".join(p.text for p in doc.paragraphs)
            except Exception:
                return f"[DOCX content from: {os.path.basename(file_path)}]"
        else:
            # Attempt to read as text for unknown types
            try:
                with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except Exception:
                return f"[Binary content from: {os.path.basename(file_path)}]"
    except Exception as e:
        return f"[Error extracting text: {str(e)}]"


def extract_structured_fields(raw_text: str, filename: str) -> dict:
    """Extract structured fields from raw text (simulated NLP)."""
    words = raw_text.split() if raw_text else []
    word_count = len(words)

    # Generate title from first line or filename
    first_line = raw_text.strip().split("\n")[0][:100] if raw_text.strip() else filename
    title = first_line if len(first_line) > 3 else filename

    # Determine category based on content heuristics
    text_lower = raw_text.lower() if raw_text else ""
    if any(w in text_lower for w in ["invoice", "payment", "amount", "total"]):
        category = "Financial"
    elif any(w in text_lower for w in ["contract", "agreement", "terms", "clause"]):
        category = "Legal"
    elif any(w in text_lower for w in ["report", "analysis", "findings", "research"]):
        category = "Report"
    elif any(w in text_lower for w in ["resume", "experience", "education", "skills"]):
        category = "Resume"
    else:
        category = "General"

    # Generate summary (first 200 chars)
    summary = raw_text[:200].strip() + "..." if len(raw_text) > 200 else raw_text.strip()

    # Extract keywords (top frequency words, filtered)
    stop_words = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "it", "this", "that", "was", "are",
        "be", "has", "had", "have", "not", "as", "we", "they", "can", "will",
    }
    word_freq = {}
    for w in words:
        cleaned = w.lower().strip(".,!?;:\"'()-[]{}").strip()
        if len(cleaned) > 2 and cleaned not in stop_words and cleaned.isalpha():
            word_freq[cleaned] = word_freq.get(cleaned, 0) + 1
    keywords = sorted(word_freq, key=word_freq.get, reverse=True)[:10]

    return {
        "title": title,
        "category": category,
        "summary": summary,
        "keywords": keywords,
        "meta_data": {
            "word_count": word_count,
            "char_count": len(raw_text),
            "line_count": raw_text.count("\n") + 1 if raw_text else 0,
        },
    }


@celery_app.task(
    bind=True,
    name="app.worker.tasks.process_document",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def process_document(self, document_id: str):
    """
    Multi-stage document processing pipeline.
    Publishes progress events via Redis Pub/Sub at each stage.
    """
    session = SyncSession()
    doc_id = document_id

    try:
        # Fetch document
        doc = session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
        if not doc:
            # Document was deleted before this task ran — discard silently, do NOT retry
            # (retrying will never help since the document is gone from the DB)
            return {"status": "discarded", "reason": f"Document {doc_id} not found (likely deleted)"}

        # --- Stage 1: Job Started ---
        doc.status = DocumentStatus.PROCESSING
        session.commit()
        publish_progress(doc_id, "job_started", 5, "Processing job started")
        time.sleep(0.5)

        # --- Stage 2: Parsing Started ---
        publish_progress(doc_id, "document_parsing_started", 15, "Parsing document content...")
        time.sleep(1)

        # --- Stage 3: Parse the file ---
        raw_text = extract_text_from_file(doc.file_path, doc.file_type)
        publish_progress(doc_id, "document_parsing_completed", 40, "Document parsing completed")
        time.sleep(0.5)

        # --- Stage 4: Extraction Started ---
        publish_progress(doc_id, "field_extraction_started", 55, "Extracting structured fields...")
        time.sleep(1)

        # --- Stage 5: Extract structured data ---
        fields = extract_structured_fields(raw_text, doc.filename)
        publish_progress(doc_id, "field_extraction_completed", 80, "Field extraction completed")
        time.sleep(0.5)

        # --- Stage 6: Store result ---
        publish_progress(doc_id, "storing_result", 90, "Storing final result...")

        # Delete existing result if retrying
        existing = (
            session.query(ProcessingResult)
            .filter(ProcessingResult.document_id == doc.id)
            .first()
        )
        if existing:
            session.delete(existing)
            session.flush()

        result = ProcessingResult(
            id=uuid.uuid4(),
            document_id=doc.id,
            title=fields["title"],
            category=fields["category"],
            summary=fields["summary"],
            keywords=fields["keywords"],
            meta_data=fields["meta_data"],
            raw_text=raw_text,
        )
        session.add(result)

        # --- Stage 7: RAG Embedding ---
        publish_progress(doc_id, "embedding_started", 92, "Generating embeddings for RAG...")
        try:
            from app.services.rag_service import index_document_text

            stored = index_document_text(doc_id, raw_text)
            if stored:
                publish_progress(doc_id, "embedding_completed", 97, f"Embedded {stored} chunks for RAG")
            else:
                publish_progress(doc_id, "embedding_completed", 97, "No chunks to embed")
        except Exception as emb_err:
            # Embedding failure should not fail the whole pipeline
            publish_progress(doc_id, "embedding_warning", 97, f"Embedding skipped: {str(emb_err)[:100]}")

        # --- Stage 8: Job Completed ---
        doc.status = DocumentStatus.COMPLETED
        doc.error_message = None
        session.commit()
        publish_progress(doc_id, "job_completed", 100, "Processing completed successfully")

        return {"status": "completed", "document_id": doc_id}

    except Exception as exc:
        session.rollback()
        # Update document status to FAILED
        try:
            doc = session.query(Document).filter(Document.id == uuid.UUID(doc_id)).first()
            if doc:
                doc.status = DocumentStatus.FAILED
                doc.error_message = str(exc)[:500]
                session.commit()
        except Exception:
            session.rollback()

        publish_progress(doc_id, "job_failed", 0, f"Processing failed: {str(exc)[:200]}")

        # Retry with exponential backoff for genuine processing errors
        raise self.retry(exc=exc, countdown=10 * (self.request.retries + 1), max_retries=3)

    finally:
        session.close()


# ---------------------------------------------------------------------------
# Retrieval, delegated from the API
# ---------------------------------------------------------------------------
# The embedding model, the cross-encoder and chromadb together cost several
# hundred MB. Loading them in the API process as well as here would exceed the
# 512MB instance and the kernel kills the container — which is what made chat
# requests take the whole service down. The worker already needs them to index
# documents, so it answers retrieval for the API too and stays the only process
# that ever holds them.


@celery_app.task(name="app.worker.tasks.retrieve_context", soft_time_limit=120, time_limit=150)
def retrieve_context(question: str, document_ids: list[str] | None = None) -> dict:
    """Run the retrieval half of the RAG pipeline and return the built context."""
    from app.services.rag_service import rag_query

    # stream=True returns {context, sources, pipeline_info} without generating
    # an answer — the API streams that itself.
    return rag_query(question=question, document_ids=document_ids, stream=True)


@celery_app.task(name="app.worker.tasks.rag_status", soft_time_limit=60, time_limit=90)
def rag_status() -> dict:
    """Report index stats. Runs here because it needs chromadb."""
    from app.services.rag_service import get_rag_status

    return get_rag_status()


@celery_app.task(name="app.worker.tasks.delete_index", soft_time_limit=60, time_limit=90)
def delete_index(document_id: str) -> bool:
    """Drop a document's vectors. Runs here because it needs chromadb."""
    from app.services.rag_service import delete_document_index

    delete_document_index(document_id)
    return True


@celery_app.task(
    name="app.worker.tasks.reindex_missing", soft_time_limit=1800, time_limit=1900
)
def reindex_missing() -> dict:
    """
    Rebuild vectors for completed documents that are missing from the index.

    The vector store lives on the container filesystem, which is wiped on every
    restart and deploy, so a document indexed yesterday has no chunks today and
    chat answers "I couldn't find any information" about documents that plainly
    exist. The extracted text is in Postgres, so the index can be rebuilt from
    there without the original file — which matters because uploads are wiped
    by the same restart.
    """
    from app.services.rag_service import collection_chunk_count, index_document_text

    session = SyncSession()
    restored, already_indexed, no_text = 0, 0, 0
    try:
        rows = (
            session.query(Document, ProcessingResult)
            .join(ProcessingResult, ProcessingResult.document_id == Document.id)
            .filter(Document.status == DocumentStatus.COMPLETED)
            .all()
        )

        for doc, result in rows:
            doc_id = str(doc.id)
            if collection_chunk_count(doc_id) > 0:
                already_indexed += 1
                continue
            if not result.raw_text:
                no_text += 1
                continue
            try:
                index_document_text(doc_id, result.raw_text)
                restored += 1
            except Exception:
                logger.exception("Could not reindex document %s", doc_id)

        summary = {
            "restored": restored,
            "already_indexed": already_indexed,
            "no_text": no_text,
        }
        logger.info("Reindex sweep: %s", summary)
        return summary
    finally:
        session.close()
