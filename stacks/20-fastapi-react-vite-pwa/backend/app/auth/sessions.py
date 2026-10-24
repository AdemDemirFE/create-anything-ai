"""Cookie-based session management (the documented auth decision).

Decision: **server-side sessions, not JWT.** Rationale (full text in
ARCHITECTURE.md §3):

- Logout/revocation must be immediate and server-side; stateless JWT would
  need a denylist, which is server-side state with extra steps anyway.
- No cross-service token exchange exists at this scope, so JWT's main
  benefit does not apply.
- HttpOnly + SameSite=Lax cookies mitigate XSS token theft and basic CSRF
  for the allowlisted same-origin SPA.

Sessions live in the in-memory store keyed by the SHA-256 digest of the
cookie token. The raw token is never stored server-side and never logged.

TTL model (review round 1): the 30-minute timeout is an **idle timeout** —
every authenticated request calls `STORE.refresh_session`, which slides
`expires_at` forward from the last activity. Activity resets the timer
(test-asserted); a session untouched for 30 minutes expires even for an
account that logged in seconds earlier from a different device context.

Route-handler pattern: FastAPI discards header mutations made to the injected
`response` parameter when the handler returns its own Response, so handlers
build their envelope Response first and call `attach_session_cookie` on that
exact object.
"""

from __future__ import annotations

from fastapi import Request, Response

from app import config
from app.security import new_session_token, session_token_digest
from app.store import STORE, Session, User


def create_session_token(user: User) -> str:
    """Create server-side session state; returns the raw cookie token."""
    token = new_session_token()
    STORE.create_session(session_token_digest(token), user.id, config.SESSION_TTL_SECONDS)
    return token


def attach_session_cookie(response: Response, token: str) -> None:
    """Set the session cookie on the Response that will be returned."""
    response.set_cookie(
        key=config.SESSION_COOKIE_NAME,
        value=token,
        max_age=config.SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=config.SECURE_COOKIES,
        path="/",
    )


def start_session(response: Response, user: User) -> str:
    """Convenience: create state + attach cookie to the returned Response."""
    token = create_session_token(user)
    attach_session_cookie(response, token)
    return token


def destroy_session(request: Request, response: Response) -> None:
    """Invalidate server-side and clear the cookie (logout)."""
    token = request.cookies.get(config.SESSION_COOKIE_NAME)
    if token:
        STORE.delete_session(session_token_digest(token))
    response.delete_cookie(
        key=config.SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=config.SECURE_COOKIES,
    )


def current_user(request: Request) -> User | None:
    """Resolve the authenticated user from the session cookie, if valid.

    Every successful resolution counts as activity and slides the idle
    window: expiry is measured from the last request, not from login (the
    documented idle-timeout decision; test-asserted in tests/test_security_store.py
    and ARCHITECTURE.md §3).
    """
    token = request.cookies.get(config.SESSION_COOKIE_NAME)
    if not token:
        return None
    digest = session_token_digest(token)
    session: Session | None = STORE.get_session(digest)
    if session is None:
        return None
    STORE.refresh_session(digest, config.SESSION_TTL_SECONDS)
    return STORE.get_user_by_id(session.user_id)
