"""
Document API routes: upload, list, detail, retry, finalize, export, edit.
"""

import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas import (
    DocumentListResponse,
    DocumentResponse,
    ProcessingResultUpdate,
    UploadResponse,
)
from app.services import document_service, export_service
from app.services.auth_service import get_current_user
from app.models import User

router = APIRouter(prefix="/api/documents", tags=["Documents"])

# Read uploads off the wire in 1MB slices.
CHUNK_SIZE = 1024 * 1024


@router.post("/upload", response_model=UploadResponse, status_code=201)
async def upload_documents(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload one or more documents for processing."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    uploaded_docs = []

    for file in files:
        file_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1] if file.filename else ""
        safe_filename = f"{file_id}{ext}"
        file_path = os.path.join(settings.UPLOAD_DIR, safe_filename)

        # Stream to disk in chunks rather than reading the whole file into memory —
        # a single 50MB upload would otherwise be held in RAM twice.
        file_size = 0
        try:
            with open(file_path, "wb") as f:
                while chunk := await file.read(CHUNK_SIZE):
                    file_size += len(chunk)
                    if file_size > settings.MAX_FILE_SIZE:
                        raise HTTPException(
                            status_code=413,
                            detail=(
                                f"File {file.filename} exceeds max size of "
                                f"{settings.MAX_FILE_SIZE} bytes"
                            ),
                        )
                    f.write(chunk)
        except Exception:
            if os.path.exists(file_path):
                os.remove(file_path)
            raise

        # Create document record + dispatch Celery task
        doc = await document_service.create_document(
            session=db,
            filename=file.filename or "unnamed",
            file_path=file_path,
            file_type=file.content_type or "application/octet-stream",
            file_size=file_size,
            user_id=current_user.id,
        )
        uploaded_docs.append(doc)

    return UploadResponse(
        documents=[DocumentResponse.model_validate(doc) for doc in uploaded_docs],
        message=f"Successfully uploaded {len(uploaded_docs)} document(s)",
    )


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    search: Optional[str] = Query(None, description="Search by filename"),
    status: Optional[str] = Query(None, description="Filter by status"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List documents with search, filter, sort, and pagination."""
    documents, total = await document_service.get_documents(
        session=db,
        search=search,
        status=status,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
        user_id=current_user.id,
    )
    return DocumentListResponse(
        documents=[DocumentResponse.model_validate(doc) for doc in documents],
        total=total,
        page=page,
        page_size=page_size,
    )


# NOTE: Bulk export must be registered BEFORE /{document_id} to avoid
# FastAPI treating "export" as a UUID path parameter.
@router.get("/export/bulk")
async def export_all_documents(
    format: str = Query("json", description="Export format: json or csv"),
    finalized_only: bool = Query(True, description="Export finalized only"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk export all finalized documents."""
    if format not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="Format must be 'json' or 'csv'")

    data = await export_service.export_all_documents(db, current_user.id, format, finalized_only)
    media_type = "application/json" if format == "json" else "text/csv"
    filename = f"documents_export.{format}"

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get document details with processing result."""
    doc = await document_service.get_document_by_id(db, document_id)
    if not doc or doc.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentResponse.model_validate(doc)


@router.post("/{document_id}/retry", response_model=DocumentResponse)
async def retry_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retry processing of a failed document."""
    doc = await document_service.get_document_by_id(db, document_id)
    if not doc or doc.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        doc = await document_service.retry_document(db, document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return DocumentResponse.model_validate(doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{document_id}/result", response_model=DocumentResponse)
async def update_document_result(
    document_id: uuid.UUID,
    updates: ProcessingResultUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit/update the processing result for a document."""
    doc = await document_service.get_document_by_id(db, document_id)
    if not doc or doc.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    
    result = await document_service.update_result(
        db, document_id, updates.model_dump(exclude_unset=True)
    )
    if not result:
        raise HTTPException(
            status_code=404, detail="Processing result not found for this document"
        )
    doc = await document_service.get_document_by_id(db, document_id)
    return DocumentResponse.model_validate(doc)


@router.post("/{document_id}/finalize", response_model=DocumentResponse)
async def finalize_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a completed document as finalized."""
    doc = await document_service.get_document_by_id(db, document_id)
    if not doc or doc.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        doc = await document_service.finalize_document(db, document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return DocumentResponse.model_validate(doc)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{document_id}/export")
async def export_document(
    document_id: uuid.UUID,
    format: str = Query("json", description="Export format: json or csv"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a single document's finalized result."""
    if format not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="Format must be 'json' or 'csv'")

    doc = await document_service.get_document_by_id(db, document_id)
    if not doc or doc.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Document not found")

    data = await export_service.export_document(db, document_id, format)
    if data is None:
        raise HTTPException(status_code=404, detail="Document or result not found")

    media_type = "application/json" if format == "json" else "text/csv"
    filename = f"document_{document_id}.{format}"

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a document completely from DB, disk, and RAG index."""
    doc = await document_service.get_document_by_id(db, document_id)
    if not doc or doc.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Document not found")

    success = await document_service.delete_document(db, document_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found")
    
    await db.commit()
    return Response(status_code=204)
