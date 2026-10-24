"""Embedding providers (adapter pattern).

The chat/RAG pipeline depends on this interface, never on a concrete
provider. Two implementations ship:

- `build_embeddings()` with the default `fake` provider returns LangChain's
  `DeterministicFakeEmbedding`: fully offline, deterministic (the same text
  always yields the same vector), and real LangChain code - not a mock
  object. This is what the test suite and the zero-config local run use.
- `openai` lazily imports `langchain_openai.OpenAIEmbeddings`. The import
  is deferred so the default path never requires the package or a key;
  `OPENAI_API_KEY` must come from the environment and is NEVER committed.
  langchain-openai is an optional dependency (documented in README /
  .env.example), which keeps `pip install -r requirements.txt` honest.
"""

from __future__ import annotations

from functools import lru_cache

from langchain_core.embeddings import Embeddings

from app import config


@lru_cache(maxsize=1)
def _fake_embeddings() -> Embeddings:
    # Real LangChain class; deterministic by construction (seeded hashing).
    from langchain_core.embeddings import DeterministicFakeEmbedding

    return DeterministicFakeEmbedding(size=config.EMBEDDING_DIMENSION)


def _openai_embeddings() -> Embeddings:
    try:
        from langchain_openai import OpenAIEmbeddings
    except ImportError as exc:  # pragma: no cover - depends on optional pkg
        raise RuntimeError(
            "STACK23_EMBEDDING_PROVIDER=openai requires the optional "
            "dependency 'langchain-openai' (pip install langchain-openai)."
        ) from exc
    import os

    if not os.getenv("OPENAI_API_KEY"):
        # Fail fast with a clear message; the key must never be committed.
        raise RuntimeError(
            "STACK23_EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY in "
            "the environment."
        )
    return OpenAIEmbeddings()  # reads OPENAI_API_KEY from the environment


def build_embeddings() -> Embeddings:
    """Factory: resolve the configured embedding backend."""
    provider = config.embedding_provider()
    if provider == "fake":
        return _fake_embeddings()
    if provider == "openai":
        return _openai_embeddings()
    raise RuntimeError(f"Unknown STACK23_EMBEDDING_PROVIDER: {provider!r}")
