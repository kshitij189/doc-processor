"""
Service for exporting finalized documents as JSON or CSV.
"""

import csv
import io
import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Document, DocumentStatus, ProcessingResult


async def export_document(
    session: AsyncSession,
    document_id,
    format: str = "json",
) -> Optional[str]:
    """Export a single finalized document."""
    query = (
        select(Document)
        .options(selectinload(Document.result))
        .where(Document.id == document_id)
    )
    result = await session.execute(query)
    doc = result.scalar_one_or_none()

    if not doc or not doc.result:
        return None

    record = _document_to_export_dict(doc)

    if format == "csv":
        return _to_csv([record])
    return json.dumps(record, indent=2, default=str)


async def export_all_documents(
    session: AsyncSession,
    format: str = "json",
    finalized_only: bool = True,
) -> str:
    """Export all finalized documents."""
    query = select(Document).options(selectinload(Document.result))
    if finalized_only:
        query = query.where(Document.is_finalized == True)
    else:
        query = query.where(Document.status == DocumentStatus.COMPLETED)

    result = await session.execute(query)
    docs = list(result.scalars().all())

    records = [_document_to_export_dict(doc) for doc in docs if doc.result]

    if format == "csv":
        return _to_csv(records)
    return json.dumps(records, indent=2, default=str)


def _document_to_export_dict(doc: Document) -> dict:
    """Convert a document + result to a flat export dictionary."""
    r = doc.result
    return {
        "document_id": str(doc.id),
        "filename": doc.filename,
        "file_type": doc.file_type,
        "file_size": doc.file_size,
        "status": doc.status.value if doc.status else "",
        "is_finalized": doc.is_finalized,
        "title": r.title if r else "",
        "category": r.category if r else "",
        "summary": r.summary if r else "",
        "keywords": ", ".join(r.keywords) if r and r.keywords else "",
        "word_count": r.meta_data.get("word_count", 0) if r and r.meta_data else 0,
        "created_at": str(doc.created_at),
        "updated_at": str(doc.updated_at),
    }


def _to_csv(records: list[dict]) -> str:
    """Convert list of dicts to CSV string."""
    if not records:
        return ""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=records[0].keys())
    writer.writeheader()
    writer.writerows(records)
    return output.getvalue()
