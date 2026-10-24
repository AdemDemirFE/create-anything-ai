"""Envelope contract tests (docs/PRODUCT_REQUIREMENTS.md section 7).

The envelope is part of the frozen repository contract: every JSON response
must be exactly `{success, data, error, meta}` with `meta` carrying
`timestamp` and `request_id` (plus `execution_ms` only where measured -
chat turns).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

REQUIRED_TOP_LEVEL = {"success", "data", "error", "meta"}
REQUIRED_META = {"timestamp", "request_id"}


def assert_envelope(body: dict, *, success: bool) -> None:
    assert set(body.keys()) == REQUIRED_TOP_LEVEL
    assert body["success"] is success
    assert isinstance(body["meta"], dict)
    assert REQUIRED_META.issubset(body["meta"].keys())
    # ISO-8601 UTC timestamp ending in Z
    assert body["meta"]["timestamp"].endswith("Z")
    assert body["meta"]["request_id"]


def test_success_envelope_shape(client: TestClient) -> None:
    res = client.post(
        "/api/v1/register", json={"email": "env@b.co", "password": "CorrectHorse1"}
    )
    assert res.status_code == 201
    body = res.json()
    assert_envelope(body, success=True)
    assert body["data"] == {"email": "env@b.co"}
    assert body["error"] is None
    # execution_ms is NOT fabricated for register (only chat runs).
    assert "execution_ms" not in body["meta"]


def test_error_envelope_shape(client: TestClient) -> None:
    res = client.post("/api/v1/login", json={"email": "ghost@b.co", "password": "nope123456"})
    assert res.status_code == 401
    body = res.json()
    assert_envelope(body, success=False)
    assert body["data"] is None
    err = body["error"]
    assert set(err.keys()) == {"code", "message"}
    assert err["code"] == "INVALID_CREDENTIALS"


def test_validation_error_envelope_has_field_details(client: TestClient) -> None:
    res = client.post("/api/v1/register", json={"email": "not-an-email", "password": "short"})
    assert res.status_code == 422
    body = res.json()
    assert_envelope(body, success=False)
    assert body["error"]["code"] == "VALIDATION_ERROR"
    fields = {d["field"] for d in body["error"]["details"]}
    assert "email" in fields
    assert "password" in fields


def test_chat_envelope_carries_measured_execution_ms(
    auth_client: TestClient,
) -> None:
    import io

    auth_client.post(
        "/api/v1/documents",
        files={"file": ("doc.md", io.BytesIO("LangChain orchestrates RAG pipelines.".encode()), "text/markdown")},
    )
    res = auth_client.post("/api/v1/chat", json={"question": "What orchestrates pipelines?"})
    assert res.status_code == 200
    body = res.json()
    assert_envelope(body, success=True)
    # Present exactly where measurement is meaningful.
    assert isinstance(body["meta"]["execution_ms"], (int, float))
    assert body["data"]["executionMs"] == body["meta"]["execution_ms"]


def test_request_id_header_matches_envelope(client: TestClient) -> None:
    res = client.get("/api/v1/health", headers={"X-Request-Id": "corr-123"})
    assert res.headers["X-Request-Id"] == "corr-123"


def test_valid_request_id_formats_are_accepted(client: TestClient) -> None:
    """^[A-Za-z0-9-]{1,64}$: alphanumerics and hyphens up to 64 chars."""
    res = client.get("/api/v1/health", headers={"X-Request-Id": "ABC-123"})
    assert res.headers["X-Request-Id"] == "ABC-123"
    res = client.get("/api/v1/health", headers={"X-Request-Id": "a" * 64})
    assert res.headers["X-Request-Id"] == "a" * 64
    # Underscore is not in the class -> replaced.
    res = client.get("/api/v1/health", headers={"X-Request-Id": "bad_id"})
    assert res.headers["X-Request-Id"] != "bad_id"


def test_invalid_request_id_is_replaced_with_opaque_id(client: TestClient) -> None:
    """Header-injection / log-forging values must not reach the envelope."""
    for bad in ("bad id with spaces", "id;injected", "x" * 65, "id..//..//"):
        res = client.get("/api/v1/health", headers={"X-Request-Id": bad})
        returned = res.headers["X-Request-Id"]
        assert returned != bad, bad
        assert len(returned) == 32
        assert all(c in "0123456789abcdef" for c in returned)


def test_invalid_request_id_does_not_leak_into_envelope(
    auth_client: TestClient,
) -> None:
    res = auth_client.get("/api/v1/me", headers={"X-Request-Id": "inj;ected-id"})
    body = res.json()
    assert body["meta"]["request_id"] != "inj;ected-id"
    assert len(body["meta"]["request_id"]) == 32


def test_missing_request_id_gets_generated_one(client: TestClient) -> None:
    res = client.get("/api/v1/health")
    assert len(res.headers["X-Request-Id"]) == 32
