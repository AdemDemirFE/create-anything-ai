"""Unit tests: password hashing, token hygiene, store behavior, envelope."""

from __future__ import annotations

import pytest

from app import config
from app.security import (
    hash_password,
    new_session_token,
    session_token_digest,
    verify_password,
)
from app.store import STORE


class TestPasswords:
    def test_hash_and_verify_roundtrip(self) -> None:
        h = hash_password("CorrectHorse1")
        assert h.startswith("$2")
        assert verify_password("CorrectHorse1", h)

    def test_wrong_password_fails(self) -> None:
        h = hash_password("CorrectHorse1")
        assert not verify_password("wrong", h)

    def test_hashes_are_salted_unique(self) -> None:
        assert hash_password("same") != hash_password("same")

    def test_long_password_not_truncated_silently(self) -> None:
        """bcrypt truncates at 72 bytes; pre-hashing keeps long secrets distinct."""
        a = "x" * 80 + "suffix-a"
        b = "x" * 80 + "suffix-b"
        ha, hb = hash_password(a), hash_password(b)
        assert verify_password(a, ha)
        assert verify_password(b, hb)
        assert not verify_password(b, ha)

    def test_malformed_hash_is_verification_failure_not_crash(self) -> None:
        assert not verify_password("x", "not-a-bcrypt-hash")


class TestSessionTokens:
    def test_tokens_are_random_and_256bit(self) -> None:
        tokens = {new_session_token() for _ in range(50)}
        assert len(tokens) == 50
        for t in tokens:
            assert len(t) == 64  # 32 bytes hex-encoded

    def test_digest_is_deterministic_and_differs_from_raw(self) -> None:
        token = new_session_token()
        assert session_token_digest(token) == session_token_digest(token)
        assert session_token_digest(token) != token


class TestStore:
    def test_user_roundtrip_and_unique_email(self) -> None:
        STORE.reset()
        STORE.create_user("a@b.co", "h1")
        with pytest.raises(ValueError):
            STORE.create_user("A@B.CO", "h2")  # case-insensitive uniqueness
        assert STORE.get_user_by_email("a@b.co") is not None
        assert STORE.get_user_by_email("A@B.CO") is not None

    def test_session_expiry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        STORE.reset()
        user = STORE.create_user("s@b.co", "h")
        STORE.create_session("digest", user.id, config.SESSION_TTL_SECONDS)
        assert STORE.get_session("digest") is not None
        # Simulate expiry by moving the clock forward past the TTL.
        monkeypatch.setattr("time.time", lambda: 2_000_000_000 + 10_000)
        assert STORE.get_session("digest") is None

    def test_throttle_window_and_reset(self) -> None:
        STORE.reset()
        for _ in range(5):
            STORE.record_failed_login("t@b.co", "1.2.3.4")
        assert STORE.is_throttled("t@b.co", "1.2.3.4")
        assert not STORE.is_throttled("t@b.co", "5.6.7.8")  # other IP unaffected
        STORE.clear_failed_logins("t@b.co", "1.2.3.4")
        assert not STORE.is_throttled("t@b.co", "1.2.3.4")
