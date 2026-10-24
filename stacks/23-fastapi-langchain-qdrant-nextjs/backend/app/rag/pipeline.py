"""RAG pipeline orchestrator: ingest -> embed -> retrieve -> generate.

Holds process-singleton adapters (built from configuration) and exposes the
two operations the API routes call. Generation and retrieval are synchronous
pure-Python work (bounded by ingest limits), kept off the hot path by small
input bounds; embedding calls are local for the fake/local providers.
"""

from __future__ import annotations

import threading

from app import config
from app.rag.embeddings import build_embeddings
from app.rag.generator import generate_answer
from app.rag.ingest import IngestResult, ingest_document
from app.rag.vector_store import RetrievedChunk, VectorStoreAdapter, build_vector_store

_lock = threading.Lock()
_embeddings = None
_vector_store: VectorStoreAdapter | None = None


def embeddings_instance():
    global _embeddings
    with _lock:
        if _embeddings is None:
            _embeddings = build_embeddings()
        return _embeddings


def vector_store_instance() -> VectorStoreAdapter:
    global _vector_store
    with _lock:
        if _vector_store is None:
            _vector_store = build_vector_store()
        return _vector_store


def reset_instances() -> None:
    """Test-only: drop cached singletons so config changes take effect."""
    global _embeddings, _vector_store
    with _lock:
        _embeddings = None
        _vector_store = None


def ingest(
    user_id: str, document_id: str, filename: str, text: str
) -> IngestResult:
    return ingest_document(
        user_id=user_id,
        document_id=document_id,
        filename=filename,
        text=text,
        store=vector_store_instance(),
    )


def retrieve(user_id: str, question: str, top_k: int = config.CHAT_TOP_K) -> list[RetrievedChunk]:
    embeddings = embeddings_instance()
    vector = embeddings.embed_query(question)
    return vector_store_instance().search(user_id=user_id, vector=vector, top_k=top_k)


def answer(user_id: str, question: str) -> tuple[str, list[RetrievedChunk]]:
    """Full chat turn: retrieve then generate. Returns (answer, sources)."""
    chunks = retrieve(user_id, question)
    return generate_answer(question, chunks), chunks
