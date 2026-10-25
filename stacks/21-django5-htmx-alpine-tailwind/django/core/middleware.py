"""Stack 21 middleware: X-Request-Id correlation and body-size cap.

Request-Id policy (matches Stack-20's reviewed decision):
- A client-supplied ``X-Request-Id`` is accepted only when it matches
  ``^[A-Za-z0-9-]{1,64}$``; anything else is discarded and a fresh opaque
  32-hex id is generated.
- The validated id is echoed back as the ``X-Request-Id`` response header and
  is available as ``request.request_id`` for the JSON envelope.
- A UUID cannot be used for the generated id: it must be opaque, so it is
  rendered as 32 hex chars.
"""

from __future__ import annotations

import re
import secrets

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")

# Known safe methods never carry a body worth capping.
_BODYLESS_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def _new_request_id() -> str:
    return secrets.token_hex(16)


class RequestIdMiddleware:
    """Validate/echo X-Request-Id and cap request body size (413)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        raw = request.headers.get("X-Request-Id", "")
        if raw and _REQUEST_ID_RE.fullmatch(raw):
            request.request_id = raw
        else:
            request.request_id = _new_request_id()

        from django.conf import settings

        max_bytes = getattr(settings, "MAX_BODY_BYTES", 256 * 1024)
        if request.method not in _BODYLESS_METHODS:
            declared = request.headers.get("Content-Length")
            try:
                length = int(declared) if declared is not None else None
            except ValueError:
                length = None
            if length is not None and length > max_bytes:
                from core.envelope import ERR_PAYLOAD_TOO_LARGE, error_response

                return error_response(
                    request,
                    status=413,
                    code=ERR_PAYLOAD_TOO_LARGE,
                )

        response = self.get_response(request)
        response["X-Request-Id"] = request.request_id
        return response
