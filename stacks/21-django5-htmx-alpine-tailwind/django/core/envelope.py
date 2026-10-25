"""API envelope helpers for the Stack 21 reference implementation.

Envelope contract (task contract, deviation from PRD §7 default documented in
ARCHITECTURE.md):

    {"ok": true,  "data": {...}, "error": null,  "requestId": "..."}
    {"ok": false, "data": null,  "error": {...}, "requestId": "..."}

``error`` is a stable object with a stable ``code`` and a safe ``message``:
no stack traces, no SQL, no internals.
"""

from __future__ import annotations

import logging
from typing import Any

from django.http import HttpRequest, JsonResponse

logger = logging.getLogger(__name__)

# Stable error codes.
ERR_VALIDATION = "VALIDATION_ERROR"
ERR_INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
ERR_EMAIL_TAKEN = "EMAIL_TAKEN"
ERR_UNAUTHENTICATED = "UNAUTHENTICATED"
ERR_NOT_FOUND = "NOT_FOUND"
ERR_THROTTLED = "THROTTLED"
ERR_INPUT_TOO_LARGE = "INPUT_TOO_LARGE"
ERR_UNKNOWN_ALGORITHM = "UNKNOWN_ALGORITHM"
ERR_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
ERR_SERVER = "SERVER_ERROR"
ERR_METHOD = "METHOD_NOT_ALLOWED"
ERR_CSRF = "CSRF_FAILURE"

# Safe, stable, client-displayable messages per code.
_SAFE_MESSAGES: dict[str, str] = {
    ERR_VALIDATION: "The request contains invalid fields.",
    ERR_INVALID_CREDENTIALS: "Invalid email or password.",
    ERR_EMAIL_TAKEN: "This email is already registered.",
    ERR_UNAUTHENTICATED: "Authentication is required.",
    ERR_NOT_FOUND: "Resource not found.",
    ERR_THROTTLED: "Too many attempts. Please wait and try again.",
    ERR_INPUT_TOO_LARGE: "Input exceeds the 10,000 character limit.",
    ERR_UNKNOWN_ALGORITHM: "Unknown algorithm requested.",
    ERR_PAYLOAD_TOO_LARGE: "Request body is too large.",
    ERR_SERVER: "An unexpected error occurred.",
    ERR_METHOD: "Method not allowed.",
    ERR_CSRF: "Invalid or missing CSRF token.",
}


def error_message(code: str) -> str:
    return _SAFE_MESSAGES.get(code, _SAFE_MESSAGES[ERR_SERVER])


def _request_id(request: HttpRequest) -> str:
    return str(getattr(request, "request_id", "") or "")


def success_response(
    request: HttpRequest,
    *,
    data: Any,
    status: int = 200,
    headers: dict[str, str] | None = None,
) -> JsonResponse:
    """Build an enveloped success response."""
    payload = {"ok": True, "data": data, "error": None, "requestId": _request_id(request)}
    response = JsonResponse(payload, status=status)
    if headers:
        for key, value in headers.items():
            response[key] = value
    return response


def error_response(
    request: HttpRequest,
    *,
    status: int,
    code: str,
    details: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JsonResponse:
    """Build an enveloped error response with a safe message."""
    payload = {
        "ok": False,
        "data": None,
        "error": {"code": code, "message": error_message(code)},
        "requestId": _request_id(request),
    }
    if details:
        payload["error"]["details"] = details
    logger.info(
        "envelope_error code=%s status=%s path=%s",
        code,
        status,
        getattr(request, "path", "?"),
    )
    response = JsonResponse(payload, status=status)
    if headers:
        for key, value in headers.items():
            response[key] = value
    return response


def validation_error(
    request: HttpRequest, details: list[dict[str, Any]]
) -> JsonResponse:
    """422 with field-level details ({"field", "message"} entries)."""
    return error_response(request, status=422, code=ERR_VALIDATION, details=details)
