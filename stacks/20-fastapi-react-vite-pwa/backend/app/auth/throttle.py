"""Login throttle: 5 failed attempts per 60s window per email+client-IP.

Demo-grade, in-process (see ARCHITECTURE.md); production deployments should
enforce limits at the edge. Exceeding the limit returns HTTP 429 with a
Retry-After header. Successes never count and a successful login clears the
tally, so legitimate users are not locked out by prior typos.
"""

from __future__ import annotations

from fastapi import Request

from app.store import STORE


def client_ip(request: Request) -> str:
    """Direct connection peer only.

    X-Forwarded-For is deliberately IGNORED: without a trusted-proxy
    configuration, XFF is client-controlled and rotating it would defeat the
    throttle (stack 01 hardening, carried over by design decision).
    """
    host = request.client.host if request.client else "unknown"
    return host or "unknown"


def is_throttled(email: str, ip: str) -> bool:
    return STORE.is_throttled(email, ip)


def record_failure(email: str, ip: str) -> int:
    return STORE.record_failed_login(email, ip)


def clear_failures(email: str, ip: str) -> None:
    STORE.clear_failed_logins(email, ip)
