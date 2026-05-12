import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# --- Document Schemas ---


class DocumentBase(BaseModel):
    filename: str
    file_type: str
    file_size: int


class DocumentCreate(DocumentBase):
    file_path: str


class ProcessingResultBase(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    summary: Optional[str] = None
    keywords: list[str] = Field(default_factory=list)
    meta_data: dict = Field(default_factory=dict)
    raw_text: Optional[str] = None


class ProcessingResultResponse(ProcessingResultBase):
    id: uuid.UUID
    document_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProcessingResultUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    summary: Optional[str] = None
    keywords: Optional[list[str]] = None


class DocumentResponse(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str
    file_size: int
    status: str
    is_finalized: bool
    celery_task_id: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    result: Optional[ProcessingResultResponse] = None

    class Config:
        from_attributes = True


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
    total: int
    page: int
    page_size: int


class UploadResponse(BaseModel):
    documents: list[DocumentResponse]
    message: str


# --- Progress Event ---


class ProgressEvent(BaseModel):
    document_id: str
    stage: str
    progress: int  # 0–100
    message: str
    timestamp: str


# --- Export ---


class ExportResponse(BaseModel):
    format: str
    data: list[dict]


# --- Chat History Schemas ---


class ChatMessageBase(BaseModel):
    role: str
    content: str
    context_docs: list = Field(default_factory=list)


class ChatMessageResponse(ChatMessageBase):
    id: uuid.UUID
    session_id: uuid.UUID
    created_at: datetime

    class Config:
        from_attributes = True


class ChatSessionBase(BaseModel):
    title: Optional[str] = None


class ChatSessionResponse(ChatSessionBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ChatSessionDetailResponse(ChatSessionResponse):
    messages: list[ChatMessageResponse] = Field(default_factory=list)


# --- Auth Schemas ---


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
