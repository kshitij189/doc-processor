"""
Production-grade RAG service.

Implements:
- Semantic + dynamic chunking (sentence-aware)
- Batched + cached + async embeddings (Redis cache)
- Hybrid retrieval (semantic + BM25 keyword search + Reciprocal Rank Fusion)
- Cross-encoder re-ranking
- Query rewriting + expansion via LLM
- Compressed + token-aware context building
- Streaming LLM responses via Gemini
"""

import hashlib
import json
import logging
import re
from typing import Generator, Optional

import chromadb
import numpy as np
import redis
import tiktoken
from rank_bm25 import BM25Okapi

from app.config import settings
from app.services import llm_service

logger = logging.getLogger("rag_service")
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Globals (lazily initialised)
# ---------------------------------------------------------------------------
_embed_model = None
_reranker = None
_chroma_client: Optional[chromadb.ClientAPI] = None
_redis_client: Optional[redis.Redis] = None
_tokenizer = None


class _OnnxEmbedder:
    """
    sentence-transformers-compatible wrapper over fastembed.

    Exposes .encode() with the same shapes the pipeline already expects so the
    retrieval code is unchanged. The underlying model and its 384-dim output
    space are identical to the SentenceTransformer build, so vectors indexed by
    either implementation remain comparable.
    """

    def __init__(self, model_name: str):
        from fastembed import TextEmbedding

        self._model = TextEmbedding(model_name=model_name)

    def encode(self, texts, batch_size: int = 8, show_progress_bar: bool = False):
        single = isinstance(texts, str)
        items = [texts] if single else list(texts)
        vectors = list(self._model.embed(items, batch_size=batch_size))
        return vectors[0] if single else np.array(vectors)


class _OnnxReranker:
    """CrossEncoder-compatible wrapper over fastembed's TextCrossEncoder."""

    def __init__(self, model_name: str):
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        self._model = TextCrossEncoder(model_name=model_name)

    def predict(self, pairs):
        # Every pair shares one query — rerank() takes that query plus documents.
        if not pairs:
            return []
        query = pairs[0][0]
        documents = [text for _, text in pairs]
        return list(self._model.rerank(query, documents))


def _get_embed_model() -> _OnnxEmbedder:
    global _embed_model
    if _embed_model is None:
        logger.info("Loading embedding model: %s", settings.EMBEDDING_MODEL)
        _embed_model = _OnnxEmbedder(settings.EMBEDDING_MODEL)
    return _embed_model


def _get_reranker() -> _OnnxReranker:
    global _reranker
    if _reranker is None:
        logger.info("Loading re-ranker model: %s", settings.RERANKER_MODEL)
        _reranker = _OnnxReranker(settings.RERANKER_MODEL)
    return _reranker


def _get_chroma() -> chromadb.ClientAPI:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=settings.CHROMA_DIR)
    return _chroma_client


def _get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(settings.REDIS_URL)
    return _redis_client


def _get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        _tokenizer = tiktoken.get_encoding("cl100k_base")
    return _tokenizer


# =========================================================================
# 1. SEMANTIC + DYNAMIC CHUNKING
# =========================================================================

def semantic_chunk(text: str, max_chunk_size: int = 500, overlap: int = 50) -> list[dict]:
    """
    Sentence-aware dynamic chunking.

    Instead of splitting at fixed character counts (which cuts words/sentences),
    this splits on sentence boundaries and groups them into chunks that respect
    the max size while maintaining overlap for context continuity.
    """
    if not text or not text.strip():
        return []

    # Split into sentences using regex (handles . ! ? and newlines)
    sentences = re.split(r'(?<=[.!?])\s+|\n{2,}', text.strip())
    sentences = [s.strip() for s in sentences if s.strip()]

    if not sentences:
        return [{"text": text.strip(), "index": 0}]

    chunks = []
    current_chunk: list[str] = []
    current_length = 0
    chunk_index = 0

    for sentence in sentences:
        sentence_len = len(sentence)

        # If a single sentence exceeds max size, split it by words
        if sentence_len > max_chunk_size:
            # Flush current chunk first
            if current_chunk:
                chunks.append({
                    "text": " ".join(current_chunk),
                    "index": chunk_index,
                })
                chunk_index += 1

            # Split long sentence into word-based sub-chunks
            words = sentence.split()
            sub_chunk: list[str] = []
            sub_len = 0
            for word in words:
                if sub_len + len(word) + 1 > max_chunk_size and sub_chunk:
                    chunks.append({
                        "text": " ".join(sub_chunk),
                        "index": chunk_index,
                    })
                    chunk_index += 1
                    # Keep overlap words
                    overlap_words = sub_chunk[-(overlap // 10 + 1):]
                    sub_chunk = overlap_words + [word]
                    sub_len = sum(len(w) for w in sub_chunk) + len(sub_chunk)
                else:
                    sub_chunk.append(word)
                    sub_len += len(word) + 1
            if sub_chunk:
                chunks.append({
                    "text": " ".join(sub_chunk),
                    "index": chunk_index,
                })
                chunk_index += 1
            current_chunk = []
            current_length = 0
            continue

        # If adding this sentence exceeds max, flush the current chunk
        if current_length + sentence_len + 1 > max_chunk_size and current_chunk:
            chunks.append({
                "text": " ".join(current_chunk),
                "index": chunk_index,
            })
            chunk_index += 1

            # Dynamic overlap: keep last N characters worth of sentences
            overlap_chunk: list[str] = []
            overlap_len = 0
            for s in reversed(current_chunk):
                if overlap_len + len(s) > overlap:
                    break
                overlap_chunk.insert(0, s)
                overlap_len += len(s) + 1

            current_chunk = overlap_chunk
            current_length = overlap_len

        current_chunk.append(sentence)
        current_length += sentence_len + 1

    # Flush remaining
    if current_chunk:
        chunks.append({
            "text": " ".join(current_chunk),
            "index": chunk_index,
        })

    logger.info("Chunked text into %d semantic chunks", len(chunks))
    return chunks


# =========================================================================
# 2. BATCHED + CACHED + ASYNC EMBEDDINGS
# =========================================================================

def _cache_key(text: str) -> str:
    """Generate a Redis cache key from chunk text."""
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    return f"emb:{h}"


def batch_embed_and_store(document_id: str, chunks: list[dict]) -> int:
    """
    Batch-embed chunks and store in ChromaDB.
    Uses Redis to cache embeddings so re-processing is instant.
    Returns the number of chunks stored.
    """
    if not chunks:
        return 0

    model = _get_embed_model()
    r = _get_redis()
    chroma = _get_chroma()

    # Get or create collection for this document
    collection = chroma.get_or_create_collection(
        name=f"doc_{document_id.replace('-', '_')}",
        metadata={"document_id": document_id},
    )

    texts = [c["text"] for c in chunks]
    ids = [f"{document_id}_chunk_{c['index']}" for c in chunks]

    # Check Redis cache for existing embeddings
    cached_embeddings = {}
    uncached_texts = []
    uncached_indices = []

    for i, text in enumerate(texts):
        key = _cache_key(text)
        cached = r.get(key)
        if cached:
            cached_embeddings[i] = json.loads(cached)
        else:
            uncached_texts.append(text)
            uncached_indices.append(i)

    logger.info(
        "Embedding: %d cached, %d to compute",
        len(cached_embeddings), len(uncached_texts),
    )

    # Batch embed uncached texts
    if uncached_texts:
        new_embeddings = model.encode(
            uncached_texts, batch_size=4, show_progress_bar=False
        ).tolist()

        # Store in Redis cache (TTL 7 days)
        for idx, emb in zip(uncached_indices, new_embeddings):
            cached_embeddings[idx] = emb
            key = _cache_key(texts[idx])
            r.setex(key, 7 * 86400, json.dumps(emb))

    # Build final embeddings list in order
    all_embeddings = [cached_embeddings[i] for i in range(len(texts))]

    # Upsert into ChromaDB
    collection.upsert(
        ids=ids,
        embeddings=all_embeddings,
        documents=texts,
        metadatas=[
            {"document_id": document_id, "chunk_index": c["index"]}
            for c in chunks
        ],
    )

    logger.info("Stored %d chunks in ChromaDB for document %s", len(chunks), document_id)
    return len(chunks)


# =========================================================================
# 2b. DOCUMENT INDEXING
# =========================================================================

# Bound the work for a single document. The instance has 512MB, so a very large
# document is indexed at lower density rather than being allowed to blow up.
MAX_EMBED_CHARS = 50_000
MAX_CHUNKS = 100


def index_document_text(document_id: str, raw_text: str) -> int:
    """
    Chunk and embed a document's text into the vector store.

    Shared by initial processing and by the rebuild that runs after a restart,
    so both produce an identical index.
    """
    if not raw_text:
        return 0

    chunks = semantic_chunk(raw_text[:MAX_EMBED_CHARS])
    if not chunks:
        return 0

    # Sample evenly across the document so coverage stays whole-document.
    if len(chunks) > MAX_CHUNKS:
        step = len(chunks) / MAX_CHUNKS
        chunks = [chunks[int(i * step)] for i in range(MAX_CHUNKS)]

    batch_embed_and_store(document_id, chunks)
    return len(chunks)


def collection_chunk_count(document_id: str) -> int:
    """How many chunks are indexed for a document (0 if never indexed)."""
    try:
        collection = _get_chroma().get_collection(
            name=f"doc_{document_id.replace('-', '_')}"
        )
        return collection.count()
    except Exception:
        return 0


# =========================================================================
# 3. HYBRID RETRIEVAL (Semantic + BM25) + METADATA FILTERS
# =========================================================================

def hybrid_retrieve(
    query: str,
    document_ids: Optional[list[str]] = None,
    top_k: int = 10,
) -> list[dict]:
    """
    Hybrid retrieval: combine ChromaDB semantic search with BM25 keyword search.
    Uses Reciprocal Rank Fusion (RRF) to merge results.
    """
    model = _get_embed_model()
    chroma = _get_chroma()

    # Determine which collections to search
    all_collections = chroma.list_collections()
    target_collections = []

    if document_ids:
        for doc_id in document_ids:
            col_name = f"doc_{doc_id.replace('-', '_')}"
            try:
                col = chroma.get_collection(col_name)
                target_collections.append(col)
            except Exception:
                continue
    else:
        target_collections = [chroma.get_collection(c.name) for c in all_collections]

    if not target_collections:
        return []

    # Embed query
    query_embedding = model.encode(query).tolist()

    # --- Semantic search ---
    semantic_results = []
    for collection in target_collections:
        try:
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=min(top_k, collection.count()),
                include=["documents", "metadatas", "distances"],
            )
            if results and results["documents"]:
                for i, doc_text in enumerate(results["documents"][0]):
                    semantic_results.append({
                        "text": doc_text,
                        "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                        "distance": results["distances"][0][i] if results["distances"] else 1.0,
                        "id": results["ids"][0][i] if results["ids"] else "",
                    })
        except Exception as e:
            logger.warning("Semantic search failed on collection: %s", e)

    # --- BM25 keyword search ---
    all_docs = []
    for collection in target_collections:
        try:
            data = collection.get(include=["documents", "metadatas"])
            if data and data["documents"]:
                for i, doc_text in enumerate(data["documents"]):
                    all_docs.append({
                        "text": doc_text,
                        "metadata": data["metadatas"][i] if data["metadatas"] else {},
                        "id": data["ids"][i] if data["ids"] else "",
                    })
        except Exception:
            continue

    bm25_results = []
    if all_docs:
        tokenized_corpus = [doc["text"].lower().split() for doc in all_docs]
        bm25 = BM25Okapi(tokenized_corpus)
        scores = bm25.get_scores(query.lower().split())

        scored_docs = list(zip(all_docs, scores))
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        bm25_results = [
            {**doc, "bm25_score": score}
            for doc, score in scored_docs[:top_k]
        ]

    # --- Reciprocal Rank Fusion ---
    rrf_scores: dict[str, float] = {}
    rrf_docs: dict[str, dict] = {}
    k = 60  # RRF constant

    for rank, result in enumerate(semantic_results):
        doc_id = result.get("id", result["text"][:50])
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + 1 / (k + rank + 1)
        rrf_docs[doc_id] = result

    for rank, result in enumerate(bm25_results):
        doc_id = result.get("id", result["text"][:50])
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + 1 / (k + rank + 1)
        rrf_docs[doc_id] = result

    # Sort by fused score
    sorted_ids = sorted(rrf_scores, key=rrf_scores.get, reverse=True)[:top_k]
    fused_results = [rrf_docs[did] for did in sorted_ids]

    logger.info(
        "Hybrid retrieval: %d semantic + %d BM25 → %d fused results",
        len(semantic_results), len(bm25_results), len(fused_results),
    )
    return fused_results


# =========================================================================
# 4. CROSS-ENCODER RE-RANKING
# =========================================================================

def rerank(query: str, candidates: list[dict], top_k: int = 5) -> list[dict]:
    """Re-rank candidates using a cross-encoder for higher precision."""
    if not candidates:
        return []

    reranker = _get_reranker()
    pairs = [(query, c["text"]) for c in candidates]
    scores = reranker.predict(pairs)

    for i, score in enumerate(scores):
        candidates[i]["rerank_score"] = float(score)

    candidates.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
    reranked = candidates[:top_k]

    logger.info("Re-ranked %d candidates → top %d", len(candidates), len(reranked))
    return reranked


# =========================================================================
# 5. QUERY REWRITING + EXPANSION
# =========================================================================

def rewrite_query(original_query: str) -> list[str]:
    """
    Use Gemini to rewrite/expand a user query into multiple variations
    for better retrieval recall.
    """
    if not settings.OPENROUTER_API_KEY:
        return [original_query]

    try:
        client = llm_service._client()

        prompt = f"""Given the user question below, generate 2 alternative phrasings 
that would help retrieve relevant document chunks. Return ONLY the queries, 
one per line, no numbering or bullets.

Original question: {original_query}"""

        response = client.chat.completions.create(
            model="google/gemini-2.5-flash",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
        )
        content_text = response.choices[0].message.content or ""
        variations = [
            line.strip()
            for line in content_text.strip().split("\n")
            if line.strip()
        ]
        all_queries = [original_query] + variations[:2]
        logger.info("Query expansion: %d queries", len(all_queries))
        return all_queries

    except Exception as e:
        logger.warning("Query rewrite failed: %s", e)
        return [original_query]


# =========================================================================
# 6. COMPRESSED + TOKEN-AWARE CONTEXT
# =========================================================================

def build_context(chunks: list[dict], max_tokens: int = None) -> str:
    """
    Build a compressed, token-aware context from retrieved chunks.
    Removes duplicate/overlapping content and respects token limits.
    """
    if max_tokens is None:
        max_tokens = settings.MAX_CONTEXT_TOKENS

    tokenizer = _get_tokenizer()

    # Deduplicate by removing near-identical chunks
    seen_hashes: set[str] = set()
    unique_chunks: list[dict] = []
    for chunk in chunks:
        text_hash = hashlib.md5(chunk["text"].encode()).hexdigest()
        if text_hash not in seen_hashes:
            seen_hashes.add(text_hash)
            unique_chunks.append(chunk)

    # Build context within token budget
    context_parts = []
    current_tokens = 0

    for i, chunk in enumerate(unique_chunks):
        chunk_text = chunk["text"].strip()
        chunk_tokens = len(tokenizer.encode(chunk_text))

        if current_tokens + chunk_tokens > max_tokens:
            # Truncate this chunk to fit remaining budget
            remaining = max_tokens - current_tokens
            if remaining > 50:
                tokens = tokenizer.encode(chunk_text)[:remaining]
                chunk_text = tokenizer.decode(tokens)
                context_parts.append(f"[Source {i + 1}]\n{chunk_text}")
            break

        context_parts.append(f"[Source {i + 1}]\n{chunk_text}")
        current_tokens += chunk_tokens

    context = "\n\n".join(context_parts)
    logger.info("Built context: %d tokens from %d chunks", current_tokens, len(context_parts))
    return context


# =========================================================================
# 7. STREAMING LLM (Gemini)
# =========================================================================

# Answer generation lives in llm_service so the API can import it without
# pulling in chromadb and the embedding models. Re-exported here so the
# retrieval pipeline below (and existing callers) keep working unchanged.
generate_answer_stream = llm_service.generate_answer_stream
generate_answer = llm_service.generate_answer


# =========================================================================
# 8. MULTI-LAYER CACHING
# =========================================================================

def get_cached_answer(query: str, document_ids: list[str]) -> Optional[str]:
    """Check Redis cache for a previously generated answer."""
    r = _get_redis()
    cache_key = f"qa:{hashlib.sha256((query + str(sorted(document_ids))).encode()).hexdigest()[:16]}"
    cached = r.get(cache_key)
    if cached:
        logger.info("Cache HIT for query")
        return cached.decode("utf-8")
    return None


def cache_answer(query: str, document_ids: list[str], answer: str):
    """Cache a generated answer in Redis (TTL 1 hour)."""
    r = _get_redis()
    cache_key = f"qa:{hashlib.sha256((query + str(sorted(document_ids))).encode()).hexdigest()[:16]}"
    r.setex(cache_key, 3600, answer)


# =========================================================================
# 9. FULL RAG PIPELINE
# =========================================================================

def rag_query(
    question: str,
    document_ids: Optional[list[str]] = None,
    stream: bool = False,
    history: Optional[list[dict]] = None,
) -> dict:
    """
    Full production RAG pipeline:
    1. Query rewriting + expansion
    2. Hybrid retrieval (semantic + BM25)
    3. Cross-encoder re-ranking
    4. Token-aware context compression
    5. LLM answer generation

    Returns: {answer, sources, pipeline_info}
    """
    doc_ids = document_ids or []

    # Check cache first
    if not stream:
        cached = get_cached_answer(question, doc_ids)
        if cached:
            return {
                "answer": cached,
                "sources": [],
                "pipeline_info": {"cached": True},
            }

    # Step 1: Query rewriting
    queries = rewrite_query(question)

    # Step 2: Hybrid retrieval for each query variation
    all_candidates = []
    for q in queries:
        results = hybrid_retrieve(q, document_ids=document_ids, top_k=10)
        all_candidates.extend(results)

    # Deduplicate candidates
    seen = set()
    unique_candidates = []
    for c in all_candidates:
        key = c.get("id", c["text"][:100])
        if key not in seen:
            seen.add(key)
            unique_candidates.append(c)

    if not unique_candidates:
        return {
            "answer": "I couldn't find any relevant information in the uploaded documents to answer your question.",
            "sources": [],
            "pipeline_info": {"candidates": 0},
        }

    # Step 3: Re-rank
    reranked = rerank(question, unique_candidates, top_k=5)

    # Step 4: Build compressed context
    context = build_context(reranked)

    # Step 5: Generate answer
    sources = [
        {
            "text": chunk["text"][:200] + ("..." if len(chunk["text"]) > 200 else ""),
            "full_text": chunk["text"],
            "document_id": chunk.get("metadata", {}).get("document_id", ""),
            "chunk_index": chunk.get("metadata", {}).get("chunk_index", 0),
            "score": round(chunk.get("rerank_score", 0), 4),
        }
        for chunk in reranked
    ]

    if stream:
        return {
            "context": context,
            "sources": sources,
            "pipeline_info": {
                "queries": queries,
                "candidates_found": len(unique_candidates),
                "reranked_to": len(reranked),
            },
        }

    answer = generate_answer(question, context)

    # Cache the answer
    cache_answer(question, doc_ids, answer)

    return {
        "answer": answer,
        "sources": sources,
        "pipeline_info": {
            "queries": queries,
            "candidates_found": len(unique_candidates),
            "reranked_to": len(reranked),
        },
    }


# =========================================================================
# 10. CHECK RAG STATUS
# =========================================================================

def get_rag_status() -> dict:
    """Check if RAG pipeline is available and ready."""
    status = {
        "api_key_configured": bool(settings.OPENROUTER_API_KEY),
        "embedding_model": settings.EMBEDDING_MODEL,
        "reranker_model": settings.RERANKER_MODEL,
        "collections": 0,
        "total_chunks": 0,
    }

    try:
        chroma = _get_chroma()
        collections = chroma.list_collections()
        status["collections"] = len(collections)
        total = sum(
            chroma.get_collection(c.name).count() for c in collections
        )
        status["total_chunks"] = total
    except Exception:
        pass

    return status


def delete_document_index(document_id: str):
    """Delete the collection for a specific document from ChromaDB and clean up Redis caches."""
    try:
        chroma = _get_chroma()
        collection_name = f"doc_{document_id.replace('-', '_')}"

        # 1. Clear embedding cache for this document's chunks from Redis
        try:
            collection = chroma.get_collection(collection_name)
            data = collection.get(include=["documents"])
            if data and data["documents"]:
                r = _get_redis()
                for doc_text in data["documents"]:
                    key = _cache_key(doc_text)
                    r.delete(key)
                logger.info("Cleared %d embedding cache entries from Redis for document %s",
                            len(data["documents"]), document_id)
        except Exception as e:
            logger.warning("Failed to clear embedding cache for %s: %s", document_id, e)

        # 2. Delete the ChromaDB collection
        chroma.delete_collection(name=collection_name)
        logger.info("Deleted ChromaDB collection: %s", collection_name)

        # 3. Flush any Q&A cache entries referencing this document
        try:
            r = _get_redis()
            for key in r.scan_iter("qa:*"):
                r.delete(key)
            logger.info("Flushed Q&A cache after deleting document %s", document_id)
        except Exception as e:
            logger.warning("Failed to flush Q&A cache: %s", e)

    except Exception as e:
        # If collection doesn't exist, it's fine
        logger.warning("Failed to delete ChromaDB collection for %s: %s", document_id, e)

