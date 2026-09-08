"""
Chat API routes for RAG-powered Q&A.
Supports streaming responses via SSE.
"""

import json
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Query, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from app.config import settings
from app.database import get_db, async_session_factory
from app.models import ChatSession, ChatMessage, User, Document
from app.schemas import ChatSessionResponse, ChatSessionDetailResponse
from app.services import llm_service
from app.services.auth_service import get_current_user

logger = logging.getLogger("chat_api")

router = APIRouter(prefix="/api/chat", tags=["Chat / RAG"])


# Retrieval timeout. The worker handles one job at a time, so a query can sit
# behind a document being processed; this is generous enough to wait it out but
# still bounded so a request cannot hang forever.
RETRIEVAL_TIMEOUT = 180


def _retrieve(question: str, document_ids: Optional[list[str]]) -> dict:
    """
    Ask the Celery worker for the retrieval context.

    Retrieval needs the embedding model, the cross-encoder and chromadb —
    several hundred MB. The worker already loads them to index documents, so
    running them here as well would exceed the 512MB instance and get the
    container OOM-killed, which is what previously made chat requests take the
    whole API down. The API only generates the answer, which needs no models.
    """
    from app.worker.tasks import retrieve_context

    async_result = retrieve_context.delay(question, document_ids)
    return async_result.get(timeout=RETRIEVAL_TIMEOUT)


class ChatRequest(BaseModel):
    session_id: Optional[uuid.UUID] = None
    question: str
    document_ids: Optional[list[str]] = None


class ChatResponse(BaseModel):
    answer: str
    sources: list[dict]
    pipeline_info: dict

# --- Session Management ---

class CreateSessionRequest(BaseModel):
    title: str = "New Conversation"

@router.post("/sessions", response_model=ChatSessionResponse)
async def create_session(request: CreateSessionRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = ChatSession(title=request.title, user_id=current_user.id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session

@router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_sessions(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(ChatSession).where(ChatSession.user_id == current_user.id).order_by(ChatSession.updated_at.desc()))
    return result.scalars().all()

from sqlalchemy.orm import selectinload

@router.get("/sessions/{session_id}", response_model=ChatSessionDetailResponse)
async def get_session(session_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Fetch session with messages eager loaded
    result = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(ChatSession.id == session_id)
    )
    session = result.scalars().first()
    
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
        
    return session


# --- Chat Execution ---

async def _validate_and_prepare_chat(request: ChatRequest, db: AsyncSession, current_user: User):
    """Validates session ownership and populates/validates document_ids."""
    if request.session_id:
        sess_result = await db.execute(select(ChatSession).where(ChatSession.id == request.session_id))
        session = sess_result.scalars().first()
        if not session or session.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to access this session")
            
    if request.document_ids:
        # Validate requested documents belong to user
        doc_result = await db.execute(
            select(Document.id)
            .where(Document.id.in_(request.document_ids), Document.user_id == current_user.id)
        )
        valid_ids = {str(did) for did in doc_result.scalars().all()}
        for req_id in request.document_ids:
            if req_id not in valid_ids:
                raise HTTPException(status_code=403, detail=f"Not authorized to access document {req_id}")
    else:
        # Restrict to all of the user's documents if none specified
        doc_result = await db.execute(select(Document.id).where(Document.user_id == current_user.id))
        request.document_ids = [str(did) for did in doc_result.scalars().all()]
        # If no documents, we can just let it proceed with an empty list
        
    return request

@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    request = await _validate_and_prepare_chat(request, db, current_user)
    history_dicts = None
    if request.session_id:
        msg_result = await db.execute(select(ChatMessage).where(ChatMessage.session_id == request.session_id).order_by(ChatMessage.created_at.asc()))
        messages = msg_result.scalars().all()
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in messages]
        
        user_msg = ChatMessage(session_id=request.session_id, role="user", content=request.question)
        db.add(user_msg)
        await db.commit()

    retrieval = await run_in_threadpool(
        lambda: _retrieve(request.question, request.document_ids)
    )
    answer = await run_in_threadpool(
        lambda: llm_service.generate_answer(
            request.question, retrieval.get("context", ""), history_dicts
        )
    )
    result = {
        "answer": answer,
        "sources": retrieval.get("sources", []),
        "pipeline_info": retrieval.get("pipeline_info", {}),
    }

    if request.session_id:
        assistant_msg = ChatMessage(
            session_id=request.session_id, 
            role="assistant", 
            content=result["answer"],
            context_docs=result.get("sources", [])
        )
        db.add(assistant_msg)
        
        session_result = await db.execute(select(ChatSession).where(ChatSession.id == request.session_id))
        session = session_result.scalars().first()
        if session and session.title == "New Conversation":
            session.title = request.question[:50]
        await db.commit()

    return ChatResponse(
        answer=result["answer"],
        sources=result.get("sources", []),
        pipeline_info=result.get("pipeline_info", {}),
    )


@router.post("/stream")
async def chat_stream(request: ChatRequest, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    request = await _validate_and_prepare_chat(request, db, current_user)
    history_dicts = None
    if request.session_id:
        msg_result = await db.execute(select(ChatMessage).where(ChatMessage.session_id == request.session_id).order_by(ChatMessage.created_at.asc()))
        messages = msg_result.scalars().all()
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in messages]
        
        user_msg = ChatMessage(session_id=request.session_id, role="user", content=request.question)
        db.add(user_msg)
        await db.commit()

    pipeline_result = await run_in_threadpool(
        lambda: _retrieve(request.question, request.document_ids)
    )

    context = pipeline_result.get("context", "")
    sources = pipeline_result.get("sources", [])
    pipeline_info = pipeline_result.get("pipeline_info", {})

    async def event_generator():
        yield {
            "event": "sources",
            "data": json.dumps({"sources": sources, "pipeline_info": pipeline_info}),
        }

        full_answer = []
        token_stream = llm_service.generate_answer_stream(
            request.question, context, history=history_dicts
        )
        # Each next() on this generator waits on the LLM, so step it in a thread
        # rather than on the event loop.
        async for token in iterate_in_threadpool(token_stream):
            full_answer.append(token)
            yield {
                "event": "token",
                "data": json.dumps({"token": token}),
            }

        if request.session_id:
            # Finalize session and save message using a NEW DB session
            # since the request's original 'db' session is closed when chat_stream returns.
            async with async_session_factory() as session:
                assistant_msg = ChatMessage(
                    session_id=request.session_id, 
                    role="assistant", 
                    content="".join(full_answer),
                    context_docs=sources
                )
                session.add(assistant_msg)
                
                # Update session title if it's new
                sess_result = await session.execute(select(ChatSession).where(ChatSession.id == request.session_id))
                chat_sess = sess_result.scalars().first()
                if chat_sess and chat_sess.title == "New Conversation":
                    chat_sess.title = request.question[:50]
                    
                try:
                    await session.commit()
                except Exception as e:
                    logger.error("Error saving assistant message in stream: %s", e)
                    await session.rollback()

        yield {
            "event": "done",
            "data": json.dumps({"status": "complete"}),
        }

    return EventSourceResponse(event_generator())


@router.get("/status")
async def chat_status(current_user: User = Depends(get_current_user)):
    from app.worker.tasks import rag_status

    # Needs chromadb, so the worker answers it — see _retrieve(). The chat page
    # loads this on open, so degrade to an "unavailable" badge rather than
    # erroring when the worker is busy indexing a document.
    def _status():
        try:
            return rag_status.delay().get(timeout=30)
        except Exception as exc:
            logger.warning("RAG status unavailable: %s", exc)
            return {
                "api_key_configured": bool(settings.OPENROUTER_API_KEY),
                "embedding_model": settings.EMBEDDING_MODEL,
                "reranker_model": settings.RERANKER_MODEL,
                "collections": None,
                "total_chunks": None,
                "detail": "Index stats unavailable — the worker is busy.",
            }

    return await run_in_threadpool(_status)

