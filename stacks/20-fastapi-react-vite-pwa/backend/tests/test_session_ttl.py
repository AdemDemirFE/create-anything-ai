"""Session TTL model tests (review round 1, finding 2).

Decision: IDLE timeout (sliding window). Every authenticated request slides
`expires_at` forward from the last activity; a session untouched for the TTL
expires. These tests pin both halves: activity resets the timer, and
inactivity past the TTL expires the session.

Time control: `time.time` is monkeypatched RELATIVE to the value it had at
login (the store reads the same patched module attribute), so each step
advances the clock by a controlled delta without invalidating the session's
absolute anchor.

Test-client note: under a patched clock, httpx's own cookie jar considers the
session cookie expired (its Max-Age is checked against the patched
`time.time`) and silently stops sending it. The tests therefore send the
cookie explicitly per request instead of relying on the jar — the app-side
behavior under test is unaffected.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import config
from app import store as store_module
from app.security import session_token_digest
from app.store import STORE

PASSWORD = "IdleTimeoutTest1"
COOKIE = config.SESSION_COOKIE_NAME


class Clock:
    """Controllable fake for time.time, advanced in deltas."""

    def __init__(self) -> None:
        self.now = time.time()

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture()
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clk = Clock()
    monkeypatch.setattr(time, "time", clk)
    return clk


def _login(client: TestClient) -> str:
    client.post(
        "/api/v1/register", json={"email": "idle@b.co", "password": PASSWORD}
    )
    res = client.post("/api/v1/login", json={"email": "idle@b.co", "password": PASSWORD})
    assert res.status_code == 200
    cookie = res.headers["set-cookie"]
    return cookie.split(f"{COOKIE}=")[1].split(";")[0]


def _get(client: TestClient, token: str, path: str = "/api/v1/home"):
    """Authenticated request with an explicit cookie (jar-independent).

    The jar may already hold a same-named cookie from the login response
    (stale under the patched clock); setting over it first keeps the jar
    conflict-free, and we clear it after so state never leaks between steps.
    """
    client.cookies.set(COOKIE, token)
    try:
        return client.get(path)
    finally:
        client.cookies.clear()


def test_activity_slides_the_expiry_window(client: TestClient, clock: Clock) -> None:
    token = _login(client)
    digest = session_token_digest(token)

    # Advance 2/3 of the TTL, then make one authenticated request (activity).
    clock.advance(config.SESSION_TTL_SECONDS * 2 / 3)
    assert _get(client, token).status_code == 200
    expires_after_activity = STORE.get_session(digest).expires_at

    # An absolute-from-login model would expire here (2/3 + 2/3 > 1 TTL).
    # The idle model re-anchors expiry at the activity moment, so another
    # 2/3 of TTL later the session must still be alive — and the expiry
    # timestamp must have moved forward.
    clock.advance(config.SESSION_TTL_SECONDS * 2 / 3)
    assert _get(client, token).status_code == 200, (
        "activity must reset the idle timer (absolute TTL would have expired)"
    )
    expires_after_second = STORE.get_session(digest).expires_at
    assert expires_after_second > expires_after_activity


def test_inactivity_past_ttl_expires_even_right_after_login(
    client: TestClient, clock: Clock
) -> None:
    token = _login(client)

    # Advance past the TTL with NO activity in between: must be expired.
    clock.advance(config.SESSION_TTL_SECONDS + 5)
    res = _get(client, token)
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"
    # Lazily deleted from the store.
    assert STORE.get_session(session_token_digest(token)) is None


def test_activity_chain_keeps_session_alive_indefinitely(
    client: TestClient, clock: Clock
) -> None:
    """Continuous activity (each step < TTL) never expires the session."""
    token = _login(client)
    digest = session_token_digest(token)
    for _ in range(5):
        clock.advance(config.SESSION_TTL_SECONDS * 0.9)
        assert _get(client, token).status_code == 200
    assert STORE.get_session(digest) is not None


def test_refresh_rejects_expired_session(client: TestClient, clock: Clock) -> None:
    token = _login(client)
    digest = session_token_digest(token)
    clock.advance(config.SESSION_TTL_SECONDS + 1)
    # Direct refresh on an expired session must return None (race guard).
    assert STORE.refresh_session(digest, config.SESSION_TTL_SECONDS) is None


def test_unknown_token_refresh_returns_none(client: TestClient) -> None:
    assert STORE.refresh_session("no-such-digest", config.SESSION_TTL_SECONDS) is None


# --- opportunistic purge of never-presented expired sessions -----------------
# (review round 1 follow-up: "expired sessions are only removed when
# presented; add periodic/opportunistic purge")


def test_purge_removes_expired_sessions_without_presenting_them(
    client: TestClient, clock: Clock
) -> None:
    token_a = _login(client)
    # Second account so we can drop one session while keeping the store warm.
    client.post("/api/v1/register", json={"email": "purge@b.co", "password": PASSWORD})
    res = client.post(
        "/api/v1/login", json={"email": "purge@b.co", "password": PASSWORD}
    )
    token_b = res.headers["set-cookie"].split(f"{COOKIE}=")[1].split(";")[0]

    digest_a = session_token_digest(token_a)
    digest_b = session_token_digest(token_b)

    # Past purge interval from __init__/reset anchor, so the next activity
    # sweeps.
    clock.advance(config.SESSION_TTL_SECONDS + store_module.PURGE_INTERVAL_SECONDS + 1)

    # Presenting only session A must also sweep away expired session B,
    # even though B was never presented again.
    assert _get(client, token_a).status_code == 401  # A itself expired too
    assert STORE._sessions.get(digest_a) is None
    assert STORE._sessions.get(digest_b) is None


def test_purge_is_coalesced_within_interval(
    client: TestClient, clock: Clock
) -> None:
    """Within PURGE_INTERVAL_SECONDS of a sweep, expired sessions survive.

    Coalescing is deliberate (bounded per-request cost); this pins it so a
    future change that scans on every request is a conscious decision.
    """
    token = _login(client)
    digest = session_token_digest(token)

    clock.advance(config.SESSION_TTL_SECONDS + 5)  # expired, but < interval
    STORE.purge_expired_sessions()  # force a sweep anchor now
    # Create a fresh session; it expires; another get BEFORE the interval
    # must NOT remove it (coalesced).
    STORE.create_session(
        session_token_digest("fresh-token"), "user-id", ttl_seconds=1
    )
    clock.advance(2)  # fresh session now expired, interval not elapsed
    STORE.get_session(digest)  # triggers _maybe_purge, but coalesced
    assert STORE._sessions.get(session_token_digest("fresh-token")) is not None

    # After the interval, the next activity sweeps it.
    clock.advance(store_module.PURGE_INTERVAL_SECONDS + 1)
    STORE.get_session(digest)
    assert STORE._sessions.get(session_token_digest("fresh-token")) is None


def test_purge_expired_sessions_returns_count(clock: Clock) -> None:
    STORE.reset()
    digest = session_token_digest("forced-purge-token")
    STORE.create_session(digest, "user-id", ttl_seconds=1)
    clock.advance(2)
    assert STORE.purge_expired_sessions() == 1
    assert STORE.purge_expired_sessions() == 0
    assert STORE.get_session(digest) is None
