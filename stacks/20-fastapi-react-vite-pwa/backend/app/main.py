"""FastAPI application factory for Stack 20 (TASK-008).

Boundaries:
- Every JSON response uses the repository envelope from
  docs/PRODUCT_REQUIREMENTS.md section 7 (success/data/error/meta).
- Auth model: server-side sessions in an HttpOnly, SameSite=Lax cookie
  (decision documented in ARCHITECTURE.md §3).
- The algorithm workbench runs a fixed, bounded catalog only; user code is
  never executed.
"""

from __future__ import annotations

import secrets
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app import config
from app.api.routes import (
    UnauthorizedError,
    api_router,
    unauthorized_handler,
    validation_handler,
)
from app.web.envelope import envelope_error_response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attaches a per-request correlation id and start timestamp.

    The correlation id flows into every envelope's `meta.request_id` and the
    `X-Request-Id` response header so clients can correlate failures.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        request.state.request_id = request_id
        request.state.start_ns = time.perf_counter_ns()
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response


def create_app() -> FastAPI:
    app = FastAPI(
        title=config.APP_NAME,
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "X-Request-Id"],
        expose_headers=["X-Request-Id"],
    )
    app.add_middleware(RequestContextMiddleware)

    # Enveloped error handling for request validation (422) and missing auth
    # (401); everything unexpected falls through to the 500 handler below.
    app.add_exception_handler(RequestValidationError, validation_handler)
    app.add_exception_handler(UnauthorizedError, unauthorized_handler)

    app.include_router(api_router)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> Response:
        # Log server-side only; never leak stack traces to clients.
        print(f"unhandled error path={request.url.path} type={type(exc).__name__}")
        return envelope_error_response(
            request,
            status_code=500,
            code="INTERNAL_ERROR",
            message="An unexpected error occurred.",
        )

    # Session secret is per-process, generated with the OS CSPRNG; it never
    # leaves the process and is not a committed secret.
    app.state.session_secret = secrets.token_bytes(32)
    return app


app = create_app()
