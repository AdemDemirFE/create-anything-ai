"""Failed-login throttle: in-process, per email+client-IP, 429 + Retry-After.

Paradigm contrast note (vs. Stack-04/20): this is the Django take on the same
problem — a small thread-safe class + a decorator, no third-party dependency
(django-ratelimit is deliberately not used; the contract is small enough to
own and test directly).

Rules (pinned window, failed attempts only):
- Key: lowercase email + resolved client IP.
- Window: LOGIN_THROTTLE_WINDOW_SECONDS, pinned (not sliding).
- Only FAILED logins count; a successful login clears the tally.
- Exceeding the limit: 429 with Retry-After and code THROTTLED.
- Expiry: a block NEVER outlives its window — check() resets an expired
  bucket, and expired buckets are pruned (bounded memory, no lockout that
  survives until process restart).
- Client IP: direct socket address by default. X-Forwarded-For is honored only
  when the immediate TCP peer is in TRUSTED_PROXIES (default empty → XFF is
  entirely ignored, so spoofed XFF cannot rotate identities).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    failures: int = 0
    window_start: float = 0.0
    blocked_until: float = 0.0


class LoginThrottle:
    """Thread-safe in-process failed-login throttle (pinned window)."""

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()
        self._last_prune = 0.0

    @staticmethod
    def client_ip(request) -> str:
        """Direct socket address by default; XFF only via trusted proxies."""
        from django.conf import settings

        remote = request.META.get("REMOTE_ADDR", "")
        trusted = list(getattr(settings, "TRUSTED_PROXIES", []) or [])
        if trusted and remote in trusted:
            forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
            if forwarded:
                # Walk right-to-left; the first untrusted hop is the client.
                hops = [h.strip() for h in forwarded.split(",") if h.strip()]
                for hop in reversed(hops):
                    if hop not in trusted:
                        return hop
                return hops[0] if hops else remote
        return remote

    @staticmethod
    def key(email: str, ip: str) -> str:
        return f"{email.strip().lower()}|{ip}"

    def check(self, email: str, ip: str) -> tuple[bool, int]:
        """Return (allowed, retry_after_seconds).

        Blocked when the recorded failure tally has reached the limit (the
        next attempt — right or wrong password — is the throttled one) or an
        explicit block window is still running.
        """
        now = time.monotonic()
        with self._lock:
            key = self.key(email, ip)
            bucket = self._buckets.get(key)
            if bucket is None:
                return True, 0
            if bucket.blocked_until and now < bucket.blocked_until:
                return False, max(1, int(round(bucket.blocked_until - now)))
            if now - bucket.window_start >= self.window:
                # Window expired: the block never outlives its window —
                # reset the tally so the identity can log in again.
                self._buckets.pop(key, None)
                return True, 0
            if bucket.failures >= self.limit:
                return False, self.window
            return True, 0

    def _prune_expired(self, now: float) -> None:
        """Drop buckets whose window AND block window have both passed.

        Called opportunistically from record_failure while holding the lock,
        at most once per window — bounds memory without a background timer.
        """
        if now - self._last_prune < self.window:
            return
        self._last_prune = now
        expired = [
            key
            for key, bucket in self._buckets.items()
            if now - bucket.window_start >= self.window
            and (not bucket.blocked_until or now >= bucket.blocked_until)
        ]
        for key in expired:
            self._buckets.pop(key, None)

    def record_failure(self, email: str, ip: str) -> None:
        """Record a failed attempt. The 429 is decided by check() on the NEXT
        attempt, so the Nth failure still answers 401 (sibling-stack parity:
        with limit N, attempts 1..N get 401, attempt N+1 gets 429)."""
        now = time.monotonic()
        with self._lock:
            self._prune_expired(now)
            key = self.key(email, ip)
            bucket = self._buckets.get(key)
            if bucket is None or now - bucket.window_start >= self.window:
                bucket = _Bucket(failures=1, window_start=now)
                self._buckets[key] = bucket
            else:
                bucket.failures += 1
            if bucket.failures >= self.limit:
                bucket.blocked_until = now + self.window

    def record_success(self, email: str, ip: str) -> None:
        """A successful login clears the tally (matched attempts only)."""
        with self._lock:
            self._buckets.pop(self.key(email, ip), None)
