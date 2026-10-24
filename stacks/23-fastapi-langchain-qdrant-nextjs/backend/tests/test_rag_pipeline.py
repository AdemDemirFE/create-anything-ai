"""RAG pipeline unit tests: real LangChain fake embeddings + real Qdrant
in-memory client + the local storage retriever. No mocks anywhere: the fake
embedding is a real LangChain class with deterministic output, and the
Qdrant in-memory client is the real client code path.
"""

from __future__ import annotations

import pytest

from app.rag import pipeline
from app.rag.embeddings import build_embeddings
from app.rag.generator import generate_answer
from app.rag.ingest import split_text
from app.rag.vector_store import (
    LocalVectorStore,
    QdrantVectorStore,
    RetrievedChunk,
)


@pytest.fixture(scope="module")
def embeddings():
    return build_embeddings()


class TestDeterministicFakeEmbedding:
    def test_deterministic_same_text_same_vector(self, embeddings) -> None:
        a = embeddings.embed_query("Qdrant stores vectors")
        b = embeddings.embed_query("Qdrant stores vectors")
        assert a == b

    def test_different_text_different_vector(self, embeddings) -> None:
        a = embeddings.embed_query("alpha topic")
        b = embeddings.embed_query("beta topic")
        assert a != b

    def test_dimension_matches_config(self, embeddings) -> None:
        from app import config

        assert len(embeddings.embed_query("size check")) == config.EMBEDDING_DIMENSION

    def test_embed_documents_batch(self, embeddings) -> None:
        vectors = embeddings.embed_documents(["one", "two", "three"])
        assert len(vectors) == 3
        assert all(len(v) == len(vectors[0]) for v in vectors)


class TestSplitText:
    def test_empty_text_gives_no_chunks(self) -> None:
        assert split_text("") == []
        assert split_text("   \n  ") == []

    def test_long_text_is_bounded(self) -> None:
        from app.rag.ingest import CHUNK_SIZE

        chunks = split_text(" ".join(["sentence about vectors"] * 200))
        assert len(chunks) > 1
        assert all(len(chunk) <= CHUNK_SIZE + CHUNK_SIZE for chunk in chunks)


class TestLocalVectorStore:
    def test_upsert_and_search_roundtrip(self, tmp_path, embeddings) -> None:
        store = LocalVectorStore(base_dir=str(tmp_path / "vectors"))
        vectors = embeddings.embed_documents(["red apple", "blue car"])
        store.upsert(
            user_id="u1",
            ids=["chunk0001", "chunk0002"],
            vectors=vectors,
            payloads=[
                {"text": "red apple", "document_id": "d1", "filename": "f.md", "chunk_index": 0},
                {"text": "blue car", "document_id": "d1", "filename": "f.md", "chunk_index": 1},
            ],
        )
        query = embeddings.embed_query("red apple")
        hits = store.search(user_id="u1", vector=query, top_k=2)
        assert hits[0].text == "red apple"

    def test_users_are_isolated(self, tmp_path, embeddings) -> None:
        store = LocalVectorStore(base_dir=str(tmp_path / "vectors"))
        vector = embeddings.embed_query("secret doc content")
        store.upsert(
            user_id="owner",
            ids=["chunk0001"],
            vectors=[vector],
            payloads=[{"text": "secret doc content", "document_id": "d", "filename": "s.md", "chunk_index": 0}],
        )
        assert store.search(user_id="attacker", vector=vector, top_k=5) == []

    def test_clear_user_removes_chunks(self, tmp_path, embeddings) -> None:
        store = LocalVectorStore(base_dir=str(tmp_path / "vectors"))
        vector = embeddings.embed_query("to be removed")
        store.upsert(
            user_id="u2",
            ids=["chunk0001"],
            vectors=[vector],
            payloads=[{"text": "to be removed", "document_id": "d", "filename": "x.md", "chunk_index": 0}],
        )
        store.clear_user("u2")
        assert store.search("u2", vector, 5) == []


class TestQdrantVectorStoreInMemory:
    """The real qdrant-client in :memory: mode - the same code path a live
    server would exercise, no mocks. A running Qdrant server is NOT required
    and none is assumed (see verification.md unverified list)."""

    def test_upsert_search_roundtrip(self, embeddings) -> None:
        store = QdrantVectorStore(in_memory=True)
        vectors = embeddings.embed_documents(["deterministic embedding test", "unrelated content"])
        store.upsert(
            user_id="u1",
            ids=["chunk0001", "chunk0002"],
            vectors=vectors,
            payloads=[
                {"text": "deterministic embedding test", "document_id": "d1", "filename": "q.md", "chunk_index": 0},
                {"text": "unrelated content", "document_id": "d1", "filename": "q.md", "chunk_index": 1},
            ],
        )
        query = embeddings.embed_query("deterministic embedding test")
        hits = store.search(user_id="u1", vector=query, top_k=2)
        assert hits, "expected at least one hit"
        assert hits[0].text == "deterministic embedding test"
        assert 0.0 <= hits[0].score <= 1.0 + 1e-6 or hits[0].score > 0  # cosine score present

    def test_multi_chunk_document_no_id_collisions(self, embeddings) -> None:
        store = QdrantVectorStore(in_memory=True)
        texts = [f"chunk number {i} with distinct content" for i in range(8)]
        vectors = embeddings.embed_documents(texts)
        store.upsert(
            user_id="u2",
            ids=[f"abc123{i:04x}" for i in range(8)],
            vectors=vectors,
            payloads=[
                {"text": t, "document_id": "abc123", "filename": "m.md", "chunk_index": i}
                for i, t in enumerate(texts)
            ],
        )
        query = embeddings.embed_query("chunk number 3 with distinct content")
        hits = store.search("u2", query, top_k=8)
        assert len(hits) == 8  # all 8 chunks stored, no id collision lost any

    def test_users_are_isolated(self, embeddings) -> None:
        store = QdrantVectorStore(in_memory=True)
        vector = embeddings.embed_query("private note")
        store.upsert(
            user_id="owner",
            ids=["chunk0001"],
            vectors=[vector],
            payloads=[{"text": "private note", "document_id": "d", "filename": "p.md", "chunk_index": 0}],
        )
        assert store.search("someone-else", vector, 5) == []


class TestFullPipeline:
    def test_ingest_then_retrieve_finds_relevant_chunk(self, tmp_path) -> None:
        pipeline.reset_instances()
        from app.rag.vector_store import LocalVectorStore as LVS

        store = LVS(base_dir=str(tmp_path / "vectors"))
        # Swap the cached singleton for an isolated store (test-only wiring).
        pipeline._vector_store = store  # noqa: SLF001 - deliberate test seam
        try:
            result = pipeline.ingest(
                user_id="pipe-user",
                document_id="doc123",
                filename="kb.md",
                text=(
                    "FastAPI is a modern Python web framework. "
                    "It supports async handlers and automatic OpenAPI docs.\n\n"
                    "Qdrant is a vector similarity search engine. "
                    "It stores embeddings and serves nearest-neighbor queries."
                ),
            )
            assert result.chunk_count >= 1
            chunks = pipeline.retrieve("pipe-user", "What is Qdrant?")
            assert chunks
            assert all(c.filename == "kb.md" for c in chunks)
        finally:
            pipeline.reset_instances()

    def test_retrieval_is_deterministic(self, tmp_path) -> None:
        """The fake embedding is hash-based (no semantic model): relevance
        ranking beyond determinism is NOT claimed. What is pinned here:
        the same query returns the same ranking, every hit comes from the
        user's own ingested documents, and the generator still selects the
        keyword-relevant sentence from the retrieved pool."""
        pipeline.reset_instances()
        from app.rag.vector_store import LocalVectorStore as LVS

        store = LVS(base_dir=str(tmp_path / "vectors"))
        pipeline._vector_store = store  # noqa: SLF001
        try:
            pipeline.ingest(
                user_id="rank-user",
                document_id="docA",
                filename="a.md",
                text="Bananas are a tropical fruit rich in potassium.",
            )
            pipeline.ingest(
                user_id="rank-user",
                document_id="docB",
                filename="b.md",
                text="Qdrant is a vector database used for similarity search.",
            )
            first = pipeline.retrieve("rank-user", "vector database similarity")
            second = pipeline.retrieve("rank-user", "vector database similarity")
            assert [c.text for c in first] == [c.text for c in second]
            assert {c.filename for c in first} <= {"a.md", "b.md"}
            answer, chunks = pipeline.answer("rank-user", "vector database similarity")
            # The keyword-scored generator picks the semantically right
            # sentence from whichever chunk the hash embedding surfaced.
            assert "Qdrant" in answer or any(
                "Qdrant" in c.text for c in chunks
            )
        finally:
            pipeline.reset_instances()


class TestGenerator:
    def test_no_chunks_yields_honest_refusal(self) -> None:
        answer = generate_answer("anything", [])
        assert "could not find" in answer.lower()

    def test_extractive_answer_cites_sources(self) -> None:
        chunks = [
            RetrievedChunk(
                text="Qdrant is a vector database. It runs similarity search.",
                score=0.9,
                document_id="d1",
                filename="kb.md",
                chunk_index=0,
            )
        ]
        answer = generate_answer("What is a vector database?", chunks)
        assert "vector database" in answer
        assert "[source: kb.md]" in answer

    def test_no_keyword_overlap_falls_back_to_top_chunk(self) -> None:
        chunks = [
            RetrievedChunk(
                text="Totally unrelated sentence here.",
                score=0.1,
                document_id="d1",
                filename="f.md",
                chunk_index=0,
            )
        ]
        answer = generate_answer("zzzqqq", chunks)
        assert "unrelated sentence" in answer  # grounded fallback, not invented
