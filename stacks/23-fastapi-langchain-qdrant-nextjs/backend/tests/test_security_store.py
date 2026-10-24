"""Unit tests: security helpers and the in-memory store (Stack 23)."""

from __future__ import annotations

import time

from app import security
from app.store import STORE


class TestPasswordHashing:
    def test_hash_and_verify_roundtrip(self) -> None:
        hashed = security.hash_password("CorrectHorse1")
        assert hashed.startswith("$2b$")
        assert security.verify_password("CorrectHorse1", hashed)

    def test_wrong_password_fails(self) -> None:
        hashed = security.hash_password("CorrectHorse1")
        assert not security.verify_password("WrongPassword", hashed)

    def test_salts_are_unique(self) -> None:
        a = security.hash_password("same input")
        b = security.hash_password("same input")
        assert a != b

    def test_long_password_prehash_no_silent_truncation(self) -> None:
        long_a = "x" * 100 + "alpha"
        long_b = "x" * 100 + "beta"
        hash_a = security.hash_password(long_a)
        # bcrypt alone would truncate both to the same 72 bytes; the
        # SHA-256 pre-hash must keep them distinct.
        assert security.verify_password(long_a, hash_a)
        assert not security.verify_password(long_b, hash_a)

    def test_malformed_hash_is_clean_failure(self) -> None:
        assert security.verify_password("pw123456789", "not-a-hash") is False


class TestSessionTokens:
    def test_tokens_are_256_bit_csprng(self) -> None:
        tokens = {security.new_session_token() for _ in range(50)}
        assert len(tokens) == 50
        for token in tokens:
            assert len(token) == 64
            assert all(c in "0123456789abcdef" for c in token)

    def test_digest_is_sha256_of_token(self) -> None:
        token = security.new_session_token()
        assert security.session_token_digest(token) != token
        assert len(security.session_token_digest(token)) == 64


class TestStore:
    def test_user_create_and_duplicate(self) -> None:
        STORE.create_user("a@b.co", "hash1")
        try:
            assert STORE.get_user_by_email("A@B.CO") is not None
            try:
                STORE.create_user("a@b.co", "hash2")
                raised = False
            except ValueError:
                raised = True
            assert raised
        finally:
            STORE.reset()

    def test_session_expiry(self, monkeypatch) -> None:
        user = STORE.create_user("s@b.co", "hash")
        token_hash = "digest-" + user.id
        STORE.create_session(token_hash, user.id, ttl_seconds=60)
        assert STORE.get_session(token_hash) is not None
        future = time.time() + 120
        real_time = time.time
        monkeypatch.setattr(time, "time", lambda: future)
        try:
            assert STORE.get_session(token_hash) is None
        finally:
            monkeypatch.setattr(time, "time", real_time)
            STORE.reset()

    def test_throttle_window_and_clear(self) -> None:
        for i in range(5):
            STORE.record_failed_login("t@b.co", "1.2.3.4")
        assert STORE.is_throttled("t@b.co", "1.2.3.4")
        STORE.clear_failed_logins("t@b.co", "1.2.3.4")
        assert not STORE.is_throttled("t@b.co", "1.2.3.4")
        STORE.reset()
