"""REST endpoints for /api/v1.

Envelope contract (docs/PRODUCT_REQUIREMENTS.md §7) is applied to every
response, including validation failures (422 → VALIDATION_ERROR) and missing
authentication (401 → UNAUTHORIZED).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError

from app import config
from app.algorithm import catalog as algo
from app.api import schemas
from app.auth import sessions, throttle
from app.security import hash_password, verify_password
from app.store import STORE, User
from app.web import error_codes
from app.web.envelope import (
    envelope_error_response,
    envelope_response,
    measured_execution_ms,
    validation_error_response,
)

router = APIRouter(prefix="/api/v1")
# Alias used by the app factory (keeps the import graph explicit).
api_router = router


class UnauthorizedError(Exception):
    """Raised by the auth dependency; converted to a 401 envelope."""


def _require_user(request: Request) -> User:
    user = sessions.current_user(request)
    if user is None:
        raise UnauthorizedError()
    return user


# --- health (public; trivial probe, intentionally envelope-less) ------------
@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# --- register (public) -------------------------------------------------------
@router.post("/register")
async def register(payload: schemas.RegisterRequest, request: Request) -> Response:
    email = payload.email.lower()
    if STORE.get_user_by_email(email) is not None:
        # Stable, non-leaking duplicate response.
        return envelope_error_response(
            request,
            status_code=409,
            code=error_codes.EMAIL_TAKEN,
            message="An account with this email already exists.",
        )
    user = STORE.create_user(email, hash_password(payload.password))
    return envelope_response(
        request, data=schemas.UserOut(email=user.email), status_code=201
    )


# --- login (public, throttled) ------------------------------------------------
@router.post("/login")
async def login(
    payload: schemas.LoginRequest, request: Request, response: Response
) -> Response:
    email = payload.email.lower()
    ip = throttle.client_ip(request)

    if throttle.is_throttled(email, ip):
        throttled = envelope_error_response(
            request,
            status_code=429,
            code=error_codes.RATE_LIMITED,
            message="Too many failed login attempts. Try again later.",
        )
        throttled.headers["Retry-After"] = str(config.LOGIN_THROTTLE_RETRY_AFTER)
        return throttled

    user = STORE.get_user_by_email(email)
    if user is None or not verify_password(payload.password, user.password_hash):
        throttle.record_failure(email, ip)
        # Identical code+message for unknown email vs wrong password:
        # account enumeration is blocked (test-asserted).
        return envelope_error_response(
            request,
            status_code=401,
            code=error_codes.INVALID_CREDENTIALS,
            message="Invalid email or password.",
        )

    throttle.clear_failures(email, ip)
    # The session cookie must ride on the exact Response object that is
    # returned, so the envelope is built first, then the cookie is attached
    # to it directly (start_session creates the server-side state).
    token = sessions.create_session_token(user)
    body = envelope_response(request, data=schemas.UserOut(email=user.email))
    sessions.attach_session_cookie(body, token)
    return body


# --- logout (public by contract: clears whatever session is presented) -------
@router.post("/logout")
async def logout(request: Request) -> Response:
    body = envelope_response(request, data=None)
    sessions.destroy_session(request, body)
    return body


# --- me / home (protected) -----------------------------------------------------
@router.get("/me")
async def me(request: Request, user: User = Depends(_require_user)) -> Response:
    return envelope_response(request, data=schemas.UserOut(email=user.email))


@router.get("/home")
async def home(request: Request, user: User = Depends(_require_user)) -> Response:
    data = schemas.HomeData(
        email=user.email,
        metrics=[
            schemas.HomeMetrics(label="Active projects", value="3", unit="count"),
            schemas.HomeMetrics(label="Uptime today", value="99.9", unit="percent"),
        ],
        server_time=_meta_timestamp(),
    )
    return envelope_response(request, data=data)


# --- algorithm workbench (protected; fixed catalog, bounded input) -------------
@router.get("/algorithm")
async def algorithm_catalog(
    request: Request, user: User = Depends(_require_user)
) -> Response:
    items = [
        schemas.AlgorithmInfo(
            id=spec.id,
            name=spec.name,
            complexity=spec.complexity,
            explanation=spec.explanation,
        )
        for spec in algo.CATALOG.values()
    ]
    return envelope_response(request, data=items)


@router.post("/algorithm/run")
async def algorithm_run(
    payload: schemas.AlgorithmRunRequest, request: Request, user: User = Depends(_require_user)
) -> Response:
    if len(payload.input) > algo.MAX_INPUT_LENGTH:
        return _input_too_large(request)
    try:
        output, spec = algo.run_algorithm(payload.algorithm, payload.input)
    except algo.InputTooLargeError:
        return _input_too_large(request)
    except KeyError:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.UNKNOWN_ALGORITHM,
            message="Unknown algorithm. Choose one from the catalog.",
        )
    except ValueError:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.INVALID_INPUT,
            message="The input is invalid for this algorithm.",
        )
    result = schemas.AlgorithmRunResult(
        algorithm_id=spec.id,
        output=output,
        # Measured wall-clock duration (monotonic clock) — reported
        # separately from the theoretical Big-O; never fabricated.
        execution_ms=round(measured_execution_ms(request), 3),
        complexity=spec.complexity,
        explanation=spec.explanation,
    )
    return envelope_response(request, data=result, execution_ms=result.execution_ms)


def _input_too_large(request: Request) -> Response:
    return envelope_error_response(
        request,
        status_code=400,
        code=error_codes.INPUT_TOO_LARGE,
        message=(
            f"Input exceeds the maximum length of {algo.MAX_INPUT_LENGTH} characters."
        ),
    )


def _meta_timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# Handlers wired by the app factory in main.py.
async def validation_handler(request: Request, exc: RequestValidationError) -> Response:
    return validation_error_response(request, exc)


async def unauthorized_handler(request: Request, exc: UnauthorizedError) -> Response:
    return envelope_error_response(
        request,
        status_code=401,
        code=error_codes.UNAUTHORIZED,
        message="Authentication required.",
    )
