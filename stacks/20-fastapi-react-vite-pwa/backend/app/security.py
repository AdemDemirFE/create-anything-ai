"""Password hashing and session-token helpers.

Decision — direct `bcrypt` instead of `passlib`: passlib 1.7.4 (2020, last
release) reads `bcrypt.__about__.__version__`, which was removed in bcrypt
4.1+, producing a noisy "(trapped) error reading bcrypt version" traceback on
every hash operation. This stack calls the maintained `bcrypt` library
directly. Cost-format compatibility is unchanged (standard `$2b$` hashes).

Threading decision (review round 1): bcrypt is deliberately CPU-bound — a
12-round hash costs ~100-300 ms. Calling it directly inside `async def`
handlers would block the event loop and stall every other request. All
hash/verify calls from route handlers therefore run in a small, dedicated
`ThreadPoolExecutor` via `hash_password_async` / `verify_password_async`;
the synchronous functions remain the single implementation core (and are
what unit tests exercise directly).

- Passwords: bcrypt with automatic per-hash salt. Hashes are never returned
  by any endpoint and never logged.
- Session tokens: 32 random bytes from the OS CSPRNG (`secrets.token_hex`),
  stored only as a SHA-256 digest; the raw token lives only in the cookie.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
from concurrent.futures import ThreadPoolExecutor

import bcrypt

_MAX_BCRYPT_BYTES = 72
_HASH_ROUNDS = 12

# Dedicated executor for CPU-bound hashing: bounded so a burst of requests
# cannot spawn unbounded threads, and separate from the default executor so
# slow hashes never delay other loop offloads. max_workers >= 2 lets
# concurrent hashes proceed in parallel (covered by tests/test_concurrency.py).
_HASH_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="stack20-hash")


def _prehash(password: str) -> bytes:
    """bcrypt-safe byte input for the password.

    <=72 bytes pass through unchanged (standard bcrypt behavior). Longer
    inputs are SHA-256 pre-hashed (64 hex chars), which avoids bcrypt's
    silent 72-byte truncation for long passphrases.
    """
    raw = password.encode("utf-8")
    if len(raw) <= _MAX_BCRYPT_BYTES:
        return raw
    return hashlib.sha256(raw).hexdigest().encode("utf-8")


def hash_password(password: str) -> str:
    """CPU-bound bcrypt hash. Async handlers must use `hash_password_async`."""
    digest = _prehash(password)
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=_HASH_ROUNDS)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """CPU-bound bcrypt verify. Async handlers must use `verify_password_async`."""
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed hash in store; treat as verification failure.
        return False


async def hash_password_async(password: str) -> str:
    """Off-loop wrapper: keeps the event loop responsive during hashing."""
    return await asyncio.get_running_loop().run_in_executor(
        _HASH_EXECUTOR, hash_password, password
    )


async def verify_password_async(password: str, password_hash: str) -> bool:
    """Off-loop wrapper: keeps the event loop responsive during verification."""
    return await asyncio.get_running_loop().run_in_executor(
        _HASH_EXECUTOR, verify_password, password, password_hash
    )


# Computed once at module import (not per request, not a committed constant):
# a throwaway 12-round hash of a fixed non-secret string. It is verified
# against on unknown-email logins ONLY to equalize response timing, so an
# attacker cannot enumerate registered accounts by measuring latency.
_TIMING_EQUALIZER_HASH: str = bcrypt.hashpw(
    b"stack20-timing-equalizer (fixed non-secret throwaway input)",
    bcrypt.gensalt(rounds=_HASH_ROUNDS),
).decode("utf-8")


def timing_equalizer_hash() -> str:
    """Throwaway hash for login timing equalization (see module docstring)."""
    return _TIMING_EQUALIZER_HASH


def new_session_token() -> str:
    """256 bits of CSPRNG entropy, hex-encoded (64 chars)."""
    return secrets.token_hex(32)


def session_token_digest(token: str) -> str:
    """The store keeps only this digest; the raw token lives in the cookie."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
