"""REST endpoints for /api/v1 (Stack 23).

Envelope contract (docs/PRODUCT_REQUIREMENTS.md section 7) is applied to
every response, including validation failures (422 -> VALIDATION_ERROR) and
missing authentication (401 -> UNAUTHORIZED).

Chat is JSON-only: no StreamingResponse, no SSE (QA lesson M9 from earlier
stacks) - clients poll by issuing plain POST requests.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError

from app import config
from app.api import schemas
from app.auth import sessions, throttle
from app.rag import pipeline
from app.security import hash_password_async, timing_equalizer_hash, verify_password_async
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
    user = STORE.create_user(email, await hash_password_async(payload.password))
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
    if user is None:
        # Unknown email: burn one bcrypt verification against a fixed
        # throwaway hash so response timing does not reveal whether the
        # account exists (enumeration defense; test-asserted for shape).
        await verify_password_async(payload.password, timing_equalizer_hash())
        throttle.record_failure(email, ip)
        return envelope_error_response(
            request,
            status_code=401,
            code=error_codes.INVALID_CREDENTIALS,
            message="Invalid email or password.",
        )
    if not await verify_password_async(payload.password, user.password_hash):
        throttle.record_failure(email, ip)
        return envelope_error_response(
            request,
            status_code=401,
            code=error_codes.INVALID_CREDENTIALS,
            message="Invalid email or password.",
        )

    throttle.clear_failures(email, ip)
    # The session cookie must ride on the exact Response object that is
    # returned (Stack 20 lesson): build the envelope first, then attach.
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


# --- me / home (protected) ------------------------------------------------------
@router.get("/me")
async def me(request: Request, user: User = Depends(_require_user)) -> Response:
    return envelope_response(request, data=schemas.UserOut(email=user.email))


@router.get("/home")
async def home(request: Request, user: User = Depends(_require_user)) -> Response:
    docs = STORE.list_documents(user.id)
    chunks = sum(doc.chunk_count for doc in docs)
    data = schemas.HomeData(
        email=user.email,
        metrics=[
            schemas.HomeMetrics(label="Documents", value=str(len(docs)), unit="count"),
            schemas.HomeMetrics(label="Indexed chunks", value=str(chunks), unit="count"),
        ],
        server_time=_meta_timestamp(),
    )
    return envelope_response(request, data=data)


# --- documents (protected: upload + list) ----------------------------------------
@router.get("/documents")
async def documents_list(
    request: Request, user: User = Depends(_require_user)
) -> Response:
    items = [
        schemas.DocumentOut(
            document_id=doc.id,
            filename=doc.filename,
            size_bytes=doc.size_bytes,
            chunk_count=doc.chunk_count,
            created_at=_meta_timestamp_from(doc.created_at),
        )
        for doc in STORE.list_documents(user.id)
    ]
    return envelope_response(request, data=items)


def _decode_upload(raw: bytes) -> str:
    """Decode with a safe fallback; replace undecodable bytes."""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


@router.post("/documents")
async def documents_upload(
    request: Request,
    file: UploadFile,
    user: User = Depends(_require_user),
) -> Response:
    filename = file.filename or ""
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    if not filename:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.FILE_REQUIRED,
            message="A document file is required.",
        )
    if len(filename) > config.MAX_FILENAME_LENGTH or suffix not in config.ALLOWED_UPLOAD_SUFFIXES:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.UNSUPPORTED_FILE_TYPE,
            message="Only .txt and .md files are accepted.",
        )
    if STORE.count_documents(user.id) >= config.MAX_DOCUMENTS_PER_USER:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.DOCUMENT_LIMIT_REACHED,
            message=f"At most {config.MAX_DOCUMENTS_PER_USER} documents are allowed.",
        )

    raw = await file.read()
    if len(raw) > config.MAX_DOCUMENT_BYTES:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.FILE_TOO_LARGE,
            message=f"Documents are limited to {config.MAX_DOCUMENT_BYTES // (1024 * 1024)} MiB.",
        )
    text = _decode_upload(raw)
    if len(text) > config.MAX_DOCUMENT_CHARS:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.FILE_TOO_LARGE,
            message="Document text exceeds the maximum length.",
        )
    if not text.strip():
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.EMPTY_DOCUMENT,
            message="The document contains no readable text.",
        )

    document_id = uuid4().hex
    try:
        result = pipeline.ingest(
            user_id=user.id, document_id=document_id, filename=filename, text=text
        )
    except ValueError:
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.EMPTY_DOCUMENT,
            message="The document contains no readable text.",
        )
    doc = STORE.add_document(
        user_id=user.id,
        document_id=result.document_id,
        filename=filename,
        size_bytes=len(raw),
        chunk_count=result.chunk_count,
    )
    data = schemas.DocumentOut(
        document_id=result.document_id,
        filename=filename,
        size_bytes=len(raw),
        chunk_count=result.chunk_count,
        created_at=_meta_timestamp_from(doc.created_at),
    )
    return envelope_response(request, data=data, status_code=201)


# --- chat (protected; JSON only - no SSE, no StreamingResponse) -------------------
@router.post("/chat")
async def chat(
    payload: schemas.ChatRequest, request: Request, user: User = Depends(_require_user)
) -> Response:
    question = payload.question
    if len(question) > config.MAX_QUERY_CHARS:  # defense in depth (schema caps too)
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.QUERY_TOO_LARGE,
            message=f"Questions are limited to {config.MAX_QUERY_CHARS} characters.",
        )
    if not STORE.list_documents(user.id):
        return envelope_error_response(
            request,
            status_code=400,
            code=error_codes.NO_DOCUMENTS,
            message="Upload a document before chatting.",
        )
    answer, chunks = pipeline.answer(user.id, question)
    sources = [
        schemas.ChatSource(
            document_id=chunk.document_id,
            filename=chunk.filename,
            chunk_index=chunk.chunk_index,
            score=chunk.score,
            snippet=chunk.text[: config.CHAT_MAX_SOURCE_SNIPPET_CHARS],
        )
        for chunk in chunks
    ]
    execution_ms = round(measured_execution_ms(request), 3)
    data = schemas.ChatAnswer(
        question=question,
        answer=answer,
        sources=sources,
        execution_ms=execution_ms,
    )
    return envelope_response(request, data=data, execution_ms=execution_ms)


def _meta_timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _meta_timestamp_from(epoch_seconds: float) -> str:
    return (
        datetime.fromtimestamp(epoch_seconds, tz=UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


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
