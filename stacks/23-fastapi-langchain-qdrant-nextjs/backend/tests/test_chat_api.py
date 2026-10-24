"""Chat endpoint tests: RAG end-to-end over the real pipeline, envelope
contract, error paths, and the no-streaming (JSON-only) contract."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient

DOC = (
    "# Knowledge base\n\n"
    "Qdrant is a vector similarity search engine. It stores embeddings "
    "and serves nearest-neighbor queries.\n\n"
    "FastAPI is a modern Python web framework with async support."
)


def upload_and_ask(client: TestClient, question: str) -> object:
    client.post(
        "/api/v1/documents",
        files={"file": ("kb.md", io.BytesIO(DOC.encode()), "text/markdown")},
    )
    return client.post("/api/v1/chat", json={"question": question})


class TestChatHappyPath:
    def test_chat_returns_grounded_answer_with_sources(self, auth_client: TestClient) -> None:
        res = upload_and_ask(auth_client, "What is Qdrant?")
        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        data = body["data"]
        assert data["question"] == "What is Qdrant?"
        assert "Qdrant" in data["answer"]
        assert data["sources"], "expected at least one retrieved source"
        source = data["sources"][0]
        assert source["filename"] == "kb.md"
        assert "documentId" in source and "chunkIndex" in source
        assert isinstance(source["score"], (int, float))
        assert data["executionMs"] >= 0

    def test_chat_envelope_contract(self, auth_client: TestClient) -> None:
        res = upload_and_ask(auth_client, "Explain FastAPI")
        body = res.json()
        assert set(body.keys()) == {"success", "data", "error", "meta"}
        assert body["meta"]["request_id"]
        assert body["meta"]["timestamp"].endswith("Z")

    def test_chat_is_json_not_a_stream(self, auth_client: TestClient) -> None:
        """QA M9 lesson: no StreamingResponse/SSE - the content type must be
        plain JSON and the body must parse as one envelope."""
        res = upload_and_ask(auth_client, "What stores embeddings?")
        assert res.headers["content-type"].startswith("application/json")
        body = res.json()  # would fail on a chunked SSE stream
        assert body["success"] is True


class TestChatErrorPaths:
    def test_chat_without_documents_is_400_no_documents(self, auth_client: TestClient) -> None:
        res = auth_client.post("/api/v1/chat", json={"question": "hello?"})
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "NO_DOCUMENTS"

    def test_empty_question_is_422(self, auth_client: TestClient) -> None:
        res = auth_client.post("/api/v1/chat", json={"question": ""})
        assert res.status_code == 422
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_oversized_question_is_400_query_too_large(self, auth_client: TestClient) -> None:
        from app import config

        auth_client.post(
            "/api/v1/documents",
            files={"file": ("kb.md", io.BytesIO(DOC.encode()), "text/markdown")},
        )
        res = auth_client.post(
            "/api/v1/chat",
            json={"question": "x" * (config.MAX_QUERY_CHARS + 1)},
        )
        # Schema cap is the same value -> 422 VALIDATION_ERROR with TOO_LONG;
        # the route bound is defense in depth for manual schema changes.
        assert res.status_code in (400, 422)
        if res.status_code == 400:
            assert res.json()["error"]["code"] == "QUERY_TOO_LARGE"

    def test_extra_fields_rejected(self, auth_client: TestClient) -> None:
        res = auth_client.post(
            "/api/v1/chat", json={"question": "hi", "injected": "field"}
        )
        assert res.status_code == 422

    def test_chat_unauthenticated_is_401(self, client: TestClient) -> None:
        res = client.post("/api/v1/chat", json={"question": "hi"})
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "UNAUTHORIZED"


class TestChatIsolation:
    def test_answers_come_only_from_own_documents(self, client: TestClient) -> None:
        # User A uploads a private note.
        client.post("/api/v1/register", json={"email": "a@b.co", "password": "CorrectHorse1"})
        client.post("/api/v1/login", json={"email": "a@b.co", "password": "CorrectHorse1"})
        client.post(
            "/api/v1/documents",
            files={
                "file": (
                    "private.md",
                    io.BytesIO(b"The launch code is banana-split-42."),
                    "text/markdown",
                )
            },
        )
        client.post("/api/v1/logout")
        # User B asks about it: must get an honest "not found", never A's data.
        client.post("/api/v1/register", json={"email": "b@b.co", "password": "CorrectHorse1"})
        client.post("/api/v1/login", json={"email": "b@b.co", "password": "CorrectHorse1"})
        client.post(
            "/api/v1/documents",
            files={"file": ("public.md", io.BytesIO(b"Public weather notes: sunny."), "text/markdown")},
        )
        res = client.post("/api/v1/chat", json={"question": "What is the launch code?"})
        assert res.status_code == 200
        data = res.json()["data"]
        assert "banana" not in data["answer"].lower()
        all_sources = " ".join(s["filename"] for s in data["sources"])
        assert "private.md" not in all_sources
