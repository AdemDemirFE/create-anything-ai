"""Shared fixtures for the Stack 20 backend test suite."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.store import STORE


@pytest.fixture()
def client() -> TestClient:
    """Fresh app + wiped store per test (in-memory state is process-global)."""
    STORE.reset()
    return TestClient(create_app(), raise_server_exceptions=False)


@pytest.fixture()
def auth_headers(client: TestClient) -> dict[str, str]:
    """Convenience: register + login, return nothing (cookie jar carries auth)."""
    client.post(
        "/api/v1/register",
        json={"email": "user@example.com", "password": "CorrectHorse1"},
    )
    client.post(
        "/api/v1/login",
        json={"email": "user@example.com", "password": "CorrectHorse1"},
    )
    return {}
