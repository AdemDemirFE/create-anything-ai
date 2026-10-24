"""Application-wide configuration for Stack 23.

All values are environment-overridable; defaults are safe for local
development and for the automated test suite (fake embeddings + in-process
storage, no external service and no secret required).

The embedding/retrieval backend is configurable (adapter pattern):
- STACK23_EMBEDDING_PROVIDER=fake (default) -> langchain
  DeterministicFakeEmbedding, fully offline and deterministic.
- STACK23_EMBEDDING_PROVIDER=openai -> langchain-openai embeddings (lazy
  import; requires OPENAI_API_KEY in the environment, never committed).
- STACK23_VECTOR_STORE=local (default) -> in-process LocalVectorStore.
- STACK23_VECTOR_STORE=qdrant -> real qdrant-client against STACK23_QDRANT_URL
  (in-memory mode when STACK23_QDRANT_IN_MEMORY=1, exercised by tests).
"""

from __future__ import annotations

import os

# --- Identity ---------------------------------------------------------------
APP_NAME = "stack23-api"
API_VERSION = "v1"

# --- Sessions ----------------------------------------------------------------
SESSION_COOKIE_NAME = "STACK23_SESSION"
SESSION_TTL_SECONDS = 30 * 60  # 30-minute idle timeout, mirrors stacks 01/20
# Set SECURE_COOKIES=1 when terminating TLS in front of the app (prod).
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "").lower() in {"1", "true", "yes"}

# --- Validation policy ---------------------------------------------------------
MAX_EMAIL_LENGTH = 254
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 128

# --- Document ingest limits (upload) -------------------------------------------
MAX_DOCUMENT_BYTES = 2 * 1024 * 1024  # 2 MiB per uploaded document
MAX_DOCUMENTS_PER_USER = 50
MAX_DOCUMENT_CHARS = 400_000  # post-decode text bound (defense in depth)
ALLOWED_UPLOAD_SUFFIXES = {".txt", ".md"}
MAX_FILENAME_LENGTH = 255
MAX_QUERY_CHARS = 4_000  # chat question bound
CHAT_TOP_K = 4  # retrieved chunks per chat turn
CHAT_MAX_SOURCE_SNIPPET_CHARS = 600  # per retrieved source excerpt

# --- Login throttle --------------------------------------------------------------
LOGIN_THROTTLE_LIMIT = 5  # failed attempts ...
LOGIN_THROTTLE_WINDOW_SECONDS = 60  # ... per window, per email+client IP
LOGIN_THROTTLE_RETRY_AFTER = LOGIN_THROTTLE_WINDOW_SECONDS

# --- CORS ------------------------------------------------------------------------
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000"
)

# --- RAG backends (adapter pattern; no network access by default) ------------------
EMBEDDING_DIMENSION = 64


def _env_bool(name: str, default: str = "") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes"}


def embedding_provider() -> str:
    return os.getenv("STACK23_EMBEDDING_PROVIDER", "fake").strip().lower()


def vector_store_backend() -> str:
    return os.getenv("STACK23_VECTOR_STORE", "local").strip().lower()


def qdrant_url() -> str | None:
    return os.getenv("STACK23_QDRANT_URL") or None


def qdrant_in_memory() -> bool:
    return _env_bool("STACK23_QDRANT_IN_MEMORY", "1")


def qdrant_collection() -> str:
    return os.getenv("STACK23_QDRANT_COLLECTION", "stack23_chunks")


def allowed_origins() -> list[str]:
    """Comma-separated allowlist, overridable via ALLOWED_ORIGINS."""
    raw = os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
