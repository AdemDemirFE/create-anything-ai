"""Shared fixtures for the Stack 23 backend test suite."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.rag.pipeline import reset_instances
from app.store import STORE


@pytest.fixture()
def client() -> TestClient:
    """Fresh app + wiped store per test (in-memory state is process-global)."""
    STORE.reset()
    reset_instances()
    return TestClient(create_app(), raise_server_exceptions=False)


@pytest.fixture()
def auth_client(client: TestClient) -> TestClient:
    """Convenience: register + login; the cookie jar carries the session."""
    client.post(
        "/api/v1/register",
        json={"email": "user@example.com", "password": "CorrectHorse1"},
    )
    client.post(
        "/api/v1/login",
        json={"email": "user@example.com", "password": "CorrectHorse1"},
    )
    return client
