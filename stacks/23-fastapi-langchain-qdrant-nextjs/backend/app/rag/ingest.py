"""Document ingestion: split text into bounded chunks and embed them.

Splitting uses LangChain's `RecursiveCharacterTextSplitter` (real
langchain-text-splitters code, deterministic parameters), then each chunk is
embedded with the configured provider and upserted through the vector-store
adapter. No network access happens on the default (fake + local) path.
"""

from __future__ import annotations

from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.rag.embeddings import build_embeddings
from app.rag.vector_store import VectorStoreAdapter

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100


@dataclass
class IngestResult:
    document_id: str
    filename: str
    chunk_count: int


def split_text(text: str) -> list[str]:
    """Deterministic bounded split; blank result means an empty document."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return [chunk for chunk in splitter.split_text(text) if chunk.strip()]


def ingest_document(
    user_id: str,
    document_id: str,
    filename: str,
    text: str,
    store: VectorStoreAdapter,
) -> IngestResult:
    """Chunk -> embed -> upsert. Embeddings come from the configured adapter."""
    chunks = split_text(text)
    if not chunks:
        raise ValueError("document produced no chunks")
    embeddings = build_embeddings()
    vectors = embeddings.embed_documents(chunks)
    payloads = [
        {
            "text": chunk,
            "document_id": document_id,
            "filename": filename,
            "chunk_index": index,
        }
        for index, chunk in enumerate(chunks)
    ]
    ids = [f"{document_id}{index:04x}" for index in range(len(chunks))]
    store.upsert(user_id=user_id, ids=ids, vectors=vectors, payloads=payloads)
    return IngestResult(
        document_id=document_id, filename=filename, chunk_count=len(chunks)
    )
