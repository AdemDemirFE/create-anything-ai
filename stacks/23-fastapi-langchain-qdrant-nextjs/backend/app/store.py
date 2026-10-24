"""Thread-safe in-memory store for users, sessions, documents, and throttling.

This is a deliberate reference-stack choice: no database dependency, so the
stack runs with `pip install -r requirements.txt` alone. Data is lost on
restart, which is acceptable for a demo and documented in ARCHITECTURE.md.

All mutations are guarded by a single re-entrant lock.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class User:
    id: str
    email: str  # lowercased, unique
    password_hash: str
    created_at: float = field(default_factory=time.time)


@dataclass
class Session:
    token_hash: str  # sha256 of the cookie token; raw token never stored
    user_id: str
    created_at: float
    last_seen_at: float  # sliding-window anchor (updated on activity)
    expires_at: float  # last_seen_at + TTL (recomputed on refresh)


@dataclass
class Document:
    id: str
    user_id: str
    filename: str
    size_bytes: int
    chunk_count: int
    created_at: float


@dataclass
class ThrottleState:
    failed_count: int = 0
    window_started_at: float = 0.0


class MemoryStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._users_by_email: dict[str, User] = {}
        self._users_by_id: dict[str, User] = {}
        self._sessions: dict[str, Session] = {}
        self._documents: dict[str, list[Document]] = {}  # user_id -> docs
        self._throttle: dict[str, ThrottleState] = {}

    # --- users -------------------------------------------------------------
    def get_user_by_email(self, email: str) -> User | None:
        with self._lock:
            return self._users_by_email.get(email.lower())

    def get_user_by_id(self, user_id: str) -> User | None:
        with self._lock:
            return self._users_by_id.get(user_id)

    def create_user(self, email: str, password_hash: str) -> User:
        email = email.lower()
        with self._lock:
            if email in self._users_by_email:
                raise ValueError("email already exists")
            user = User(id=uuid4().hex, email=email, password_hash=password_hash)
            self._users_by_email[email] = user
            self._users_by_id[user.id] = user
            return user

    # --- sessions -----------------------------------------------------------
    def create_session(self, token_hash: str, user_id: str, ttl_seconds: int) -> Session:
        with self._lock:
            now = time.time()
            session = Session(
                token_hash=token_hash,
                user_id=user_id,
                created_at=now,
                last_seen_at=now,
                expires_at=now + ttl_seconds,
            )
            self._sessions[token_hash] = session
            return session

    def get_session(self, token_hash: str) -> Session | None:
        with self._lock:
            session = self._sessions.get(token_hash)
            if session is None:
                return None
            if session.expires_at < time.time():
                del self._sessions[token_hash]
                return None
            return session

    def refresh_session(self, token_hash: str, ttl_seconds: int) -> Session | None:
        """Idle-timeout anchor: slide the expiry window forward.

        Returns the refreshed session, or None when the token is unknown or
        already expired (an expired session is deleted lazily).
        """
        with self._lock:
            session = self._sessions.get(token_hash)
            if session is None:
                return None
            if session.expires_at < time.time():
                del self._sessions[token_hash]
                return None
            now = time.time()
            session.last_seen_at = now
            session.expires_at = now + ttl_seconds
            return session

    def delete_session(self, token_hash: str) -> None:
        with self._lock:
            self._sessions.pop(token_hash, None)

    # --- documents ------------------------------------------------------------
    def list_documents(self, user_id: str) -> list[Document]:
        with self._lock:
            return list(self._documents.get(user_id, []))

    def count_documents(self, user_id: str) -> int:
        with self._lock:
            return len(self._documents.get(user_id, []))

    def add_document(
        self, user_id: str, document_id: str, filename: str, size_bytes: int, chunk_count: int
    ) -> Document:
        with self._lock:
            doc = Document(
                id=document_id,
                user_id=user_id,
                filename=filename,
                size_bytes=size_bytes,
                chunk_count=chunk_count,
                created_at=time.time(),
            )
            self._documents.setdefault(user_id, []).append(doc)
            return doc

    # --- login throttle ---------------------------------------------------------
    @staticmethod
    def throttle_key(email: str, client_ip: str) -> str:
        return f"{email.lower()}|{client_ip}"

    def record_failed_login(self, email: str, client_ip: str) -> int:
        """Count one failed attempt; returns current count in the window."""
        key = self.throttle_key(email, client_ip)
        now = time.time()
        with self._lock:
            state = self._throttle.setdefault(key, ThrottleState())
            if now - state.window_started_at >= 60.0:
                # Pinned 60s window (not sliding): a new window starts at the
                # first failure after the previous one expired.
                state.window_started_at = now
                state.failed_count = 0
            state.failed_count += 1
            return state.failed_count

    def clear_failed_logins(self, email: str, client_ip: str) -> None:
        """A successful login clears the tally for that identity pair."""
        with self._lock:
            self._throttle.pop(self.throttle_key(email, client_ip), None)

    def is_throttled(self, email: str, client_ip: str) -> bool:
        key = self.throttle_key(email, client_ip)
        now = time.time()
        with self._lock:
            state = self._throttle.get(key)
            if state is None:
                return False
            if now - state.window_started_at >= 60.0:
                # Window expired without new failures; lazily reset.
                del self._throttle[key]
                return False
            return state.failed_count >= 5

    def reset(self) -> None:
        """Test-only: wipe all state between integration tests."""
        with self._lock:
            self._users_by_email.clear()
            self._users_by_id.clear()
            self._sessions.clear()
            self._documents.clear()
            self._throttle.clear()


STORE = MemoryStore()
