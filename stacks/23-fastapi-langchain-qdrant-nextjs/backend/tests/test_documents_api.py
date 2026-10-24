"""Document upload/list endpoint tests: type/size/count limits + envelopes."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient

from app import config

TEXT_FILE = ("notes.txt", io.BytesIO("FastAPI serves the RAG API.".encode()), "text/plain")
MARKDOWN_FILE = (
    "notes.md",
    io.BytesIO("# Notes\n\nQdrant stores embeddings for search.".encode()),
    "text/markdown",
)


def upload(client: TestClient, file_tuple, expect: int) -> dict:
    res = client.post("/api/v1/documents", files={"file": file_tuple})
    assert res.status_code == expect, res.text
    return res.json()


class TestDocumentsUpload:
    def test_upload_accepts_txt(self, auth_client: TestClient) -> None:
        body = upload(auth_client, TEXT_FILE, 201)
        data = body["data"]
        assert data["filename"] == "notes.txt"
        assert data["chunkCount"] >= 1
        assert data["sizeBytes"] > 0

    def test_upload_accepts_md(self, auth_client: TestClient) -> None:
        body = upload(auth_client, MARKDOWN_FILE, 201)
        assert body["data"]["filename"] == "notes.md"

    def test_upload_rejects_disallowed_extension(self, auth_client: TestClient) -> None:
        res = auth_client.post(
            "/api/v1/documents",
            files={"file": ("evil.exe", io.BytesIO(b"MZ..."), "application/octet-stream")},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"

    def test_upload_rejects_empty_filename_field(self, auth_client: TestClient) -> None:
        """An empty filename field is rejected by FastAPI's multipart
        validation (422 VALIDATION_ERROR envelope) - the abuse-relevant
        case (executable/oversized/empty) is covered by the other tests."""
        res = auth_client.post(
            "/api/v1/documents",
            files={"file": ("", io.BytesIO(b"data"), "text/plain")},
        )
        assert res.status_code == 422
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_upload_rejects_oversized_file(self, auth_client: TestClient) -> None:
        big = b"a" * (config.MAX_DOCUMENT_BYTES + 1)
        res = auth_client.post(
            "/api/v1/documents",
            files={"file": ("big.txt", io.BytesIO(big), "text/plain")},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "FILE_TOO_LARGE"

    def test_upload_rejects_empty_document(self, auth_client: TestClient) -> None:
        res = auth_client.post(
            "/api/v1/documents",
            files={"file": ("empty.txt", io.BytesIO(b"   \n  "), "text/plain")},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "EMPTY_DOCUMENT"

    def test_document_count_limit(self, auth_client: TestClient) -> None:
        for i in range(config.MAX_DOCUMENTS_PER_USER):
            upload(
                auth_client,
                (f"doc{i}.txt", io.BytesIO(f"document number {i} content".encode()), "text/plain"),
                201,
            )
        res = auth_client.post(
            "/api/v1/documents",
            files={"file": ("onemore.txt", io.BytesIO(b"one too many"), "text/plain")},
        )
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "DOCUMENT_LIMIT_REACHED"


class TestDocumentsList:
    def test_empty_list(self, auth_client: TestClient) -> None:
        body = upload(auth_client, TEXT_FILE, 201)  # ensure auth works first
        assert body["success"] is True
        res = auth_client.get("/api/v1/documents")
        assert res.status_code == 200
        listing = res.json()["data"]
        assert isinstance(listing, list)
        assert len(listing) == 1
        assert listing[0]["documentId"]
        assert listing[0]["filename"] == "notes.txt"

    def test_list_starts_empty(self, auth_client: TestClient) -> None:
        res = auth_client.get("/api/v1/documents")
        assert res.status_code == 200
        assert res.json()["data"] == []

    def test_users_see_only_their_documents(self, client: TestClient) -> None:
        client.post("/api/v1/register", json={"email": "a@b.co", "password": "CorrectHorse1"})
        client.post("/api/v1/login", json={"email": "a@b.co", "password": "CorrectHorse1"})
        upload(client, TEXT_FILE, 201)
        client.post("/api/v1/logout")
        client.post("/api/v1/register", json={"email": "b@b.co", "password": "CorrectHorse1"})
        client.post("/api/v1/login", json={"email": "b@b.co", "password": "CorrectHorse1"})
        res = client.get("/api/v1/documents")
        assert res.json()["data"] == []
