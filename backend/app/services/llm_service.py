"""
Answer generation, split out from rag_service.

This module deliberately imports nothing heavy — no chromadb, no fastembed, no
embedding models. The API process generates answers but delegates retrieval to
the Celery worker, so it must be able to reach this code without paying the
several hundred MB that importing rag_service costs.
"""

import logging
from typing import Generator, Optional

from openai import OpenAI

from app.config import settings

logger = logging.getLogger("llm_service")

ANSWER_MODEL = "google/gemini-2.5-flash"


def _client() -> OpenAI:
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=settings.OPENROUTER_API_KEY,
    )


def _build_prompt(question: str, context: str) -> str:
    return f"""You are a helpful document analysis assistant. Answer the user's
question based ONLY on the provided document context below. If the context doesn't
contain enough information to answer, say so clearly.

Be concise, accurate, and cite [Source N] references when possible.

CONTEXT:
{context}

QUESTION: {question}

ANSWER:"""


def generate_answer_stream(
    question: str,
    context: str,
    history: Optional[list[dict]] = None,
) -> Generator[str, None, None]:
    """
    Generate a streaming answer, grounded in the retrieved context.
    Yields text chunks as they arrive.
    """
    if not settings.OPENROUTER_API_KEY:
        yield "Error: OPENROUTER_API_KEY is not configured."
        return

    messages = []
    if history:
        for msg in history:
            messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": _build_prompt(question, context)})

    try:
        response = _client().chat.completions.create(
            model=ANSWER_MODEL,
            messages=messages,
            stream=True,
            max_tokens=4000,
        )
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
    except Exception as e:
        logger.error("LLM streaming failed: %s", e)
        yield f"Error generating answer: {str(e)}"


def generate_answer(
    question: str, context: str, history: Optional[list[dict]] = None
) -> str:
    """Non-streaming version for simpler use cases."""
    return "".join(generate_answer_stream(question, context, history))
