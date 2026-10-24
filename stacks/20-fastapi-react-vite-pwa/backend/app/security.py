"""Password hashing and session-token helpers.

Decision — direct `bcrypt` instead of `passlib`: passlib 1.7.4 (2020, last
release) reads `bcrypt.__about__.__version__`, which was removed in bcrypt
4.1+, producing a noisy "(trapped) error reading bcrypt version" traceback on
every hash operation. The project's own docs recommend passlib, but its
bcrypt backend detection is broken against all currently maintained bcrypt
releases, so this stack calls the maintained `bcrypt` library directly.
Cost-format compatibility is unchanged (standard `$2b$` bcrypt hashes).

- Passwords: bcrypt with automatic per-hash salt. Hashes are never returned
  by any endpoint and never logged.
- Session tokens: 32 random bytes from the OS CSPRNG (`secrets.token_hex`),
  stored only as a SHA-256 digest; the raw token lives only in the cookie.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

import bcrypt

# bcrypt has a 72-byte input limit; pre-hashing long passwords with SHA-256
# (base64-encoded to stay bcrypt-safe) removes the silent-truncation edge
# case while keeping the store format standard bcrypt.
_MAX_BCRYPT_BYTES = 72


def hash_password(password: str) -> str:
    digest = _prehash(password)
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed hash in store; treat as verification failure.
        return False


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


def new_session_token() -> str:
    """256 bits of CSPRNG entropy, hex-encoded (64 chars)."""
    return secrets.token_hex(32)


def session_token_digest(token: str) -> str:
    """The store keeps only this digest; the raw token lives in the cookie."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
