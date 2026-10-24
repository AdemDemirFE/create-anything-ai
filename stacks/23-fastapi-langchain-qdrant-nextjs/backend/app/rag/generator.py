"""Answer generation for chat turns (extractive, deterministic).

The generator is intentionally LLM-free in the reference configuration:
given the retrieved chunks it extracts the most relevant sentences and
returns a grounded answer with citations. This keeps the stack fully
deterministic, offline, and safe to test - while the embedding and
retrieval backends remain swappable adapters.

An `openai` LLM mode is recognized for deployments that opt in, but the
extractive generator remains the shipped default; enabling generative LLMs
is a follow-up concern (documented in ARCHITECTURE.md), not a hidden
network call inside this reference stack.
"""

from __future__ import annotations

import re

from app.rag.vector_store import RetrievedChunk

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]


def _keywords(question: str) -> set[str]:
    return {
        word.lower()
        for word in re.findall(r"[a-zA-Z0-9]+", question)
        if len(word) >= 3
    }


def _score_sentence(sentence: str, keywords: set[str]) -> int:
    words = {w.lower() for w in re.findall(r"[a-zA-Z0-9]+", sentence)}
    return len(words & keywords)


def generate_answer(question: str, chunks: list[RetrievedChunk]) -> str:
    """Extractive answer: keyword-scored sentences from the top chunks.

    Always cites the source documents; empty retrieval yields an explicit
    "not in your documents" response instead of a hallucinated answer.
    """
    if not chunks:
        return (
            "I could not find anything about that in your documents. "
            "Upload a document that covers this topic and ask again."
        )
    keywords = _keywords(question)
    scored: list[tuple[int, int, str, RetrievedChunk]] = []
    for rank, chunk in enumerate(chunks):
        for sentence_index, sentence in enumerate(_sentences(chunk.text)):
            score = _score_sentence(sentence, keywords)
            if score > 0:
                scored.append((score, -rank * 100 - sentence_index, sentence, chunk))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)

    picked: list[tuple[str, RetrievedChunk]] = []
    seen: set[str] = set()
    for _, _, sentence, chunk in scored:
        key = sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        picked.append((sentence, chunk))
        if len(picked) == 3:
            break

    if not picked:
        top = chunks[0]
        snippet = " ".join(_sentences(top.text)[:2]) or top.text[:300]
        picked = [(snippet, top)]

    parts: list[str] = []
    for index, (sentence, chunk) in enumerate(picked, start=1):
        parts.append(f"{index}. {sentence} [source: {chunk.filename}]")
    return "\n".join(parts)
