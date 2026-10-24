"""Concurrency tests: bcrypt off the event loop (review round 1, finding 1).

The reviewer's requirement: show that during a slow-hash request other
requests are not blocked. These tests drive real concurrent requests through
the ASGI app via httpx.AsyncClient + ASGITransport, coordinated with anyio
(pytest runs them through the anyio plugin; anyio is a FastAPI dependency
and is pinned in requirements.txt).
"""

from __future__ import annotations

import time

import anyio
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.security import (
    hash_password,
    hash_password_async,
    verify_password,
    verify_password_async,
)
from app.store import STORE

pytestmark = pytest.mark.anyio

PASSWORD = "ConcurrentTest1"


def _client() -> AsyncClient:
    app = create_app()
    STORE.reset()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _register_status(client: AsyncClient, i: int, statuses: list[int]) -> None:
    res = await client.post(
        "/api/v1/register",
        json={"email": f"conc{i}@b.co", "password": PASSWORD},
    )
    statuses.append(res.status_code)


async def test_concurrent_registrations_all_succeed(anyio_backend: str) -> None:
    """4 parallel register calls (each does a real bcrypt hash) all complete.

    Before the executor fix, each `async def` handler blocked the single
    event loop while hashing and the requests serialized. Off-loop they all
    succeed — and the wall-clock test below pins responsiveness.
    """
    async with _client() as client:
        statuses: list[int] = []

        async def run_all() -> None:
            async with anyio.create_task_group() as tg:
                for i in range(4):
                    tg.start_soon(_register_status, client, i, statuses)

        await run_all()
        assert sorted(statuses) == [201, 201, 201, 201]


async def test_health_responsive_while_hash_runs(anyio_backend: str) -> None:
    """While a register (slow bcrypt) request is in flight, a health probe
    (no hashing) completes well before the hash does.

    This is the event-loop-blocking regression test: with hashing on the
    loop, the probe could not finish until the hash finished. Off-loop, the
    probe finishes as soon as the loop can schedule it.
    """
    async with _client() as client:
        started = anyio.Event()
        hash_ms_box: list[float] = []

        async def register_once() -> None:
            start = time.perf_counter()
            started.set()
            res = await client.post(
                "/api/v1/register",
                json={"email": "slow@b.co", "password": PASSWORD},
            )
            assert res.status_code == 201
            hash_ms_box.append((time.perf_counter() - start) * 1000)

        async with anyio.create_task_group() as tg:
            tg.start_soon(register_once)
            await started.wait()

            probe_start = time.perf_counter()
            res = await client.get("/api/v1/health")
            probe_ms = (time.perf_counter() - probe_start) * 1000
            assert res.status_code == 200

        hash_ms = hash_ms_box[0]
        # The hash takes ~100-300 ms (12 rounds); the probe must not be
        # serialized behind it. Headroom guards CI noise.
        assert probe_ms < max(hash_ms * 0.5, 25.0), (
            f"health probe took {probe_ms:.0f}ms while hash took {hash_ms:.0f}ms"
        )


class TestAsyncWrappers:
    async def test_hash_async_matches_sync(self, anyio_backend: str) -> None:
        h = await hash_password_async(PASSWORD)
        assert await verify_password_async(PASSWORD, h)
        assert not await verify_password_async("wrong", h)

    async def test_parallel_hashes_all_verify(self, anyio_backend: str) -> None:
        hashes = await _gather(*(hash_password_async(f"pw-{i}-x") for i in range(6)))
        for i, h in enumerate(hashes):
            assert await verify_password_async(f"pw-{i}-x", h)

    def test_sync_functions_remain_the_core(self) -> None:
        h = hash_password(PASSWORD)
        assert verify_password(PASSWORD, h)
        assert not verify_password(PASSWORD + "x", h)


async def _gather(*aws):
    """anyio-based gather (order-preserving) for the wrapper tests."""
    results: list = [None] * len(aws)

    async def run(idx: int, aw) -> None:
        results[idx] = await aw

    async with anyio.create_task_group() as tg:
        for idx, aw in enumerate(aws):
            tg.start_soon(run, idx, aw)
    return results
