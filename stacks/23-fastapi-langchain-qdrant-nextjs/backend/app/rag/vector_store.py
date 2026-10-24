"""Vector store adapters (adapter pattern).

`VectorStoreAdapter` is the single retrieval contract for the RAG pipeline.
Two real implementations ship - there is no mock object anywhere:

- `LocalVectorStore`: brute-force cosine similarity over numpy-free pure
  Python vectors, persisted under `STACK23_LOCAL_STORAGE_DIR` (default
  `.local_storage/`, git-ignored). Default backend: zero services, so the
  reference stack runs offline while still exercising real vector math.
- `QdrantVectorStore`: the real `qdrant_client` against a configured URL,
  or `:memory:` mode (`STACK23_QDRANT_IN_MEMORY=1`) which the tests
  exercise - the same client code path a real server would use, without
  needing a running Qdrant process.

Collection naming is namespaced per user id so documents never leak across
accounts.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from app import config


@dataclass
class RetrievedChunk:
    text: str
    score: float
    document_id: str
    filename: str
    chunk_index: int


class VectorStoreAdapter:
    """Retrieval contract: upsert chunks, search by vector, clear a user."""

    def upsert(
        self, user_id: str, ids: list[str], vectors: list[list[float]], payloads: list[dict]
    ) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def search(
        self, user_id: str, vector: list[float], top_k: int
    ) -> list[RetrievedChunk]:  # pragma: no cover - interface
        raise NotImplementedError

    def clear_user(self, user_id: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


class LocalVectorStore(VectorStoreAdapter):
    """JSON-file-backed brute-force cosine store (default, zero services).

    One file per user under the storage dir keeps users isolated and makes
    the store trivially inspectable. Writes are atomic (tmp + replace) and
    guarded by a process-wide lock.
    """

    def __init__(self, base_dir: str | None = None) -> None:
        self._base = Path(base_dir or os.getenv("STACK23_LOCAL_STORAGE_DIR", ".local_storage"))
        self._base.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, user_id: str) -> Path:
        return self._base / f"user-{user_id}.json"

    def upsert(
        self, user_id: str, ids: list[str], vectors: list[list[float]], payloads: list[dict]
    ) -> None:
        with self._lock:
            path = self._path(user_id)
            data: dict[str, dict] = {}
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
            for point_id, vector, payload in zip(ids, vectors, payloads):
                data[point_id] = {"vector": vector, "payload": payload}
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            tmp.replace(path)

    def search(self, user_id: str, vector: list[float], top_k: int) -> list[RetrievedChunk]:
        with self._lock:
            path = self._path(user_id)
            if not path.exists():
                return []
            data = json.loads(path.read_text(encoding="utf-8"))
        scored: list[tuple[float, dict]] = []
        for record in data.values():
            score = _cosine(vector, record["vector"])
            scored.append((score, record["payload"]))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            RetrievedChunk(
                text=payload.get("text", ""),
                score=round(score, 6),
                document_id=payload.get("document_id", ""),
                filename=payload.get("filename", ""),
                chunk_index=int(payload.get("chunk_index", 0)),
            )
            for score, payload in scored[:top_k]
        ]

    def clear_user(self, user_id: str) -> None:
        with self._lock:
            path = self._path(user_id)
            if path.exists():
                path.unlink()


class QdrantVectorStore(VectorStoreAdapter):
    """Real qdrant-client adapter.

    `in_memory=True` (tests / no-server local run) uses the client's
    in-process mode - the same API surface as a live server, no mocks.
    `in_memory=False` connects to `STACK23_QDRANT_URL` (unverified at
    runtime in this task; see verification.md).
    """

    def __init__(
        self,
        url: str | None = None,
        in_memory: bool | None = None,
        collection_prefix: str = "stack23",
    ) -> None:
        from qdrant_client import QdrantClient

        if in_memory is None:
            in_memory = config.qdrant_in_memory()
        self._prefix = collection_prefix
        self._vector_size = config.EMBEDDING_DIMENSION
        if in_memory:
            self._client = QdrantClient(":memory:")
        else:
            resolved = url or config.qdrant_url()
            if not resolved:
                raise RuntimeError(
                    "STACK23_VECTOR_STORE=qdrant requires STACK23_QDRANT_URL "
                    "(or STACK23_QDRANT_IN_MEMORY=1)."
                )
            self._client = QdrantClient(url=resolved)
        self._ensure_collection("shared")

    def _collection(self, user_id: str) -> str:
        # Sanitize: collection names must be simple identifiers.
        safe = "".join(ch if ch.isalnum() else "-" for ch in user_id)[:64]
        return f"{self._prefix}-{safe}"

    def _ensure_collection(self, user_id: str) -> None:
        from qdrant_client.models import Distance, VectorParams

        name = self._collection(user_id)
        existing = {c.name for c in self._client.get_collections().collections}
        if name not in existing:
            self._client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=self._vector_size, distance=Distance.COSINE),
            )

    def upsert(
        self, user_id: str, ids: list[str], vectors: list[list[float]], payloads: list[dict]
    ) -> None:
        from qdrant_client.models import PointStruct

        self._ensure_collection(user_id)
        numeric_ids = [str(i) for i in ids]
        # Qdrant accepts UUID/integer point ids; derive stable numerics.
        points = [
            PointStruct(
                id=self._numeric_id(point_id),
                vector=vector,
                payload=payload,
            )
            for point_id, vector, payload in zip(numeric_ids, vectors, payloads)
        ]
        self._client.upsert(collection_name=self._collection(user_id), points=points)

    @staticmethod
    def _numeric_id(point_id: str) -> int:
        """Deterministic 63-bit integer from a hex chunk id.

        Qdrant point ids are u64; a SHA-256 prefix keeps ids stable across
        restarts and distinct for every chunk of every document (a plain
        slice of the uuid would collide between chunks of one document).
        """
        digest = hashlib.sha256(point_id.encode("utf-8")).hexdigest()
        return int(digest[:15], 16)

    def search(self, user_id: str, vector: list[float], top_k: int) -> list[RetrievedChunk]:
        self._ensure_collection(user_id)
        response = self._client.query_points(
            collection_name=self._collection(user_id), query=vector, limit=top_k
        )
        chunks: list[RetrievedChunk] = []
        for point in response.points:
            payload = point.payload or {}
            chunks.append(
                RetrievedChunk(
                    text=payload.get("text", ""),
                    score=round(float(point.score), 6),
                    document_id=payload.get("document_id", ""),
                    filename=payload.get("filename", ""),
                    chunk_index=int(payload.get("chunk_index", 0)),
                )
            )
        return chunks

    def clear_user(self, user_id: str) -> None:
        from qdrant_client.models import SelectorOptions  # noqa: F401

        self._client.delete_collection(self._collection(user_id))
        self._ensure_collection(user_id)


def build_vector_store() -> VectorStoreAdapter:
    """Factory: resolve the configured vector-store backend."""
    backend = config.vector_store_backend()
    if backend == "local":
        return LocalVectorStore()
    if backend == "qdrant":
        return QdrantVectorStore()
    raise RuntimeError(f"Unknown STACK23_VECTOR_STORE: {backend!r}")
