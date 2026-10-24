"""Cookie-based session management (the documented auth decision).

Decision: **server-side sessions, not JWT.** Logout/revocation must be
immediate and server-side; no cross-service token exchange exists at this
scope. HttpOnly + SameSite=Lax cookies mitigate XSS token theft and basic
CSRF for the allowlisted same-origin Next.js app.

TTL model (carried over from Stack 20): the 30-minute timeout is an **idle
timeout** - every authenticated request calls `STORE.refresh_session`, which
slides `expires_at` forward from the last activity.

Route-handler pattern (Stack 20 lesson): FastAPI discards header mutations
made to the injected `response` parameter when the handler returns its own
Response, so handlers build their envelope Response first and call
`attach_session_cookie` on that exact object.
"""

from __future__ import annotations

from fastapi import Request, Response

from app import config
from app.security import new_session_token, session_token_digest
from app.store import STORE, User


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
    window: expiry is measured from the last request, not from login.
    """
    token = request.cookies.get(config.SESSION_COOKIE_NAME)
    if not token:
        return None
    digest = session_token_digest(token)
    session = STORE.get_session(digest)
    if session is None:
        return None
    STORE.refresh_session(digest, config.SESSION_TTL_SECONDS)
    return STORE.get_user_by_id(session.user_id)
