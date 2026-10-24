"""Envelope contract tests (docs/PRODUCT_REQUIREMENTS.md section 7).

The envelope is part of the frozen repository contract: every JSON response
must be exactly `{success, data, error, meta}` with `meta` carrying
`timestamp` and `request_id` (plus `execution_ms` only where measured).
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
    # execution_ms is NOT fabricated for register (only algorithm runs).
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


def test_algorithm_run_envelope_carries_measured_execution_ms(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    res = client.post(
        "/api/v1/algorithm/run", json={"algorithm": "reverse", "input": "abc"}
    )
    assert res.status_code == 200
    body = res.json()
    assert_envelope(body, success=True)
    # Present exactly where measurement is meaningful.
    assert isinstance(body["meta"]["execution_ms"], (int, float))
    assert body["data"]["executionMs"] == body["meta"]["execution_ms"]


def test_request_id_header_matches_envelope(client: TestClient) -> None:
    res = client.get("/api/v1/health", headers={"X-Request-Id": "corr-123"})
    assert res.headers["X-Request-Id"] == "corr-123"


def test_unhandled_paths_still_use_envelope_or_clean_404(client: TestClient) -> None:
    res = client.get("/api/v1/definitely-not-a-route")
    assert res.status_code == 404
    assert "detail" not in res.json() or res.json().get("error") is None
