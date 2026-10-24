"""Envelope model per docs/PRODUCT_REQUIREMENTS.md section 7.

Every JSON response from this API is wrapped exactly like:

{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "timestamp": "2026-01-01T12:00:00.000Z",
    "execution_ms": 2.4,
    "request_id": "opaque-correlation-id"
  }
}

Rules enforced here:
- `data` stays `null` on errors and for empty results (the key is present).
- `error` is a stable object with `code`, safe `message`, and optional
  field-level `details` — never a stack trace.
- `execution_ms` is only included when actually measured (algorithm runs);
  it is never fabricated for other endpoints.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel

from app.web import error_codes


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _meta(request: Request, execution_ms: float | None = None) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "timestamp": _now_iso(),
        "request_id": getattr(request.state, "request_id", "n/a"),
    }
    if execution_ms is not None:
        meta["execution_ms"] = round(execution_ms, 3)
    return meta


def _dump_data(data: Any) -> Any:
    """JSON-safe dump of DTOs (aliases honored) or plain values."""
    if isinstance(data, BaseModel):
        return data.model_dump(by_alias=True, mode="json")
    if isinstance(data, list):
        return [_dump_data(item) for item in data]
    return data


def envelope_response(
    request: Request,
    data: Any,
    status_code: int = 200,
    execution_ms: float | None = None,
) -> Response:
    """Success envelope. Mutate the returned Response (e.g. cookies) freely."""
    payload = {
        "success": True,
        "data": _dump_data(data),
        "error": None,
        "meta": _meta(request, execution_ms),
    }
    return Response(
        content=json.dumps(payload),
        status_code=status_code,
        media_type="application/json",
    )


def envelope_error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: list[dict[str, str]] | None = None,
) -> Response:
    """Error envelope with a stable code; never includes stack traces."""
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    payload = {
        "success": False,
        "data": None,
        "error": error,
        "meta": _meta(request),
    }
    return Response(
        content=json.dumps(payload),
        status_code=status_code,
        media_type="application/json",
    )


def validation_error_response(request: Request, exc: RequestValidationError) -> Response:
    """Re-wrap FastAPI's 422 into the repository envelope (VALIDATION_ERROR)."""
    details: list[dict[str, str]] = []
    for err in exc.errors():
        loc = [str(part) for part in err.get("loc", []) if part != "body"]
        field = ".".join(loc) or "body"
        err_type = err.get("type", "invalid")
        code = {
            "missing": "REQUIRED",
            "string_too_long": "TOO_LONG",
            "string_too_short": "TOO_SHORT",
            "value_error": "INVALID_FORMAT",
        }.get(err_type, "INVALID")
        details.append({"field": field, "code": code})
    return envelope_error_response(
        request,
        status_code=422,
        code=error_codes.VALIDATION_ERROR,
        message="The request contains invalid fields.",
        details=details or None,
    )


def measured_execution_ms(request: Request) -> float:
    """Elapsed wall time in ms from the monotonic clock (perf_counter_ns).

    This is *measured duration*, not a Big-O claim; the algorithm response
    reports the two separately.
    """
    start_ns = getattr(request.state, "start_ns", None)
    if start_ns is None:
        return 0.0
    return (time.perf_counter_ns() - start_ns) / 1_000_000
