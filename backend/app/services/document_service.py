"""
Service layer for document business logic.
"""

import os
import uuid
from typing import Optional

from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import Document, DocumentStatus, ProcessingResult
from app.worker.tasks import process_document


async def create_document(
    session: AsyncSession,
    filename: str,
    file_path: str,
    file_type: str,
    file_size: int,
) -> Document:
    """Create a document record and dispatch Celery processing task."""
    doc = Document(
        id=uuid.uuid4(),
        filename=filename,
        file_path=file_path,
        file_type=file_type,
        file_size=file_size,
        status=DocumentStatus.QUEUED,
    )
    session.add(doc)
    await session.flush()

    # Dispatch Celery task
    task = process_document.delay(str(doc.id))
    doc.celery_task_id = task.id
    await session.flush()

    # Re-fetch with eager-loaded relationships so Pydantic can serialize
    query = (
        select(Document)
        .options(selectinload(Document.result))
        .where(Document.id == doc.id)
    )
    result = await session.execute(query)
    return result.scalar_one()


async def get_documents(
    session: AsyncSession,
    search: Optional[str] = None,
    status: Optional[str] = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Document], int]:
    """List documents with filtering, search, sorting, and pagination."""
    query = select(Document).options(selectinload(Document.result))
    count_query = select(func.count(Document.id))

    # Search by filename
    if search:
        search_filter = Document.filename.ilike(f"%{search}%")
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # Filter by status
    if status:
        try:
            status_enum = DocumentStatus(status)
            query = query.where(Document.status == status_enum)
            count_query = count_query.where(Document.status == status_enum)
        except ValueError:
            pass

    # Sorting
    sort_column = getattr(Document, sort_by, Document.created_at)
    if sort_order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    # Count total
    total_result = await session.execute(count_query)
    total = total_result.scalar() or 0

    # Pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await session.execute(query)
    documents = list(result.scalars().all())

    return documents, total


async def get_document_by_id(
    session: AsyncSession, document_id: uuid.UUID
) -> Optional[Document]:
    """Get a single document with its processing result."""
    query = (
        select(Document)
        .options(selectinload(Document.result))
        .where(Document.id == document_id)
    )
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def update_result(
    session: AsyncSession,
    document_id: uuid.UUID,
    updates: dict,
) -> Optional[ProcessingResult]:
    """Update the processing result fields for a document."""
    query = select(ProcessingResult).where(
        ProcessingResult.document_id == document_id
    )
    result = await session.execute(query)
    proc_result = result.scalar_one_or_none()
    if not proc_result:
        return None

    for key, value in updates.items():
        if value is not None and hasattr(proc_result, key):
            setattr(proc_result, key, value)

    await session.flush()
    return proc_result


async def finalize_document(
    session: AsyncSession, document_id: uuid.UUID
) -> Optional[Document]:
    """Mark a document as finalized."""
    doc = await get_document_by_id(session, document_id)
    if not doc:
        return None
    if doc.status != DocumentStatus.COMPLETED:
        raise ValueError("Only completed documents can be finalized")
    doc.is_finalized = True
    await session.flush()
    return doc


async def retry_document(
    session: AsyncSession, document_id: uuid.UUID
) -> Optional[Document]:
    """Retry a failed document processing job."""
    doc = await get_document_by_id(session, document_id)
    if not doc:
        return None
    if doc.status != DocumentStatus.FAILED:
        raise ValueError("Only failed documents can be retried")

    doc.status = DocumentStatus.QUEUED
    doc.error_message = None
    await session.flush()

    # Dispatch new Celery task
    task = process_document.delay(str(doc.id))
    doc.celery_task_id = task.id
    await session.flush()

    return doc
