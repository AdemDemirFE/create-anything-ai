"""Application-wide configuration for Stack 20.

All values are environment-overridable; defaults are safe for local
development. No secret material is required by this reference stack (the
session token is generated with `secrets` at runtime and never persisted
outside the process).
"""

from __future__ import annotations

import os

# --- Identity ------------------------------------------------------------
APP_NAME = "stack20-api"
API_VERSION = "v1"

# --- Sessions ------------------------------------------------------------
SESSION_COOKIE_NAME = "STACK20_SESSION"
SESSION_TTL_SECONDS = 30 * 60  # 30-minute idle timeout, mirrors stack 01
# Set SECURE_COOKIES=1 when terminating TLS in front of the app (prod).
SECURE_COOKIES = os.getenv("SECURE_COOKIES", "").lower() in {"1", "true", "yes"}

# --- Validation policy ---------------------------------------------------
MAX_EMAIL_LENGTH = 254
MAX_INPUT_LENGTH = 10_000  # algorithm workbench bound (chars)
MIN_PASSWORD_LENGTH = 10

# --- Login throttle ------------------------------------------------------
LOGIN_THROTTLE_LIMIT = 5  # failed attempts ...
LOGIN_THROTTLE_WINDOW_SECONDS = 60  # ... per window, per email+client IP
LOGIN_THROTTLE_RETRY_AFTER = LOGIN_THROTTLE_WINDOW_SECONDS

# --- CORS ----------------------------------------------------------------
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
)


def allowed_origins() -> list[str]:
    """Comma-separated allowlist, overridable via ALLOWED_ORIGINS."""
    raw = os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
