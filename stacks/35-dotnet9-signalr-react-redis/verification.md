# Verification — Stack 35 (TASK-009)

**Verified at (local):** 2026-10-24, 23:03–23:15 UTC+3
**Branch:** `feat/stack-35-dotnet-signalr-react-redis`
**Scope rule:** every claim below is tied to a command that actually ran in this
session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| .NET SDK | 10.0.401 | `dotnet --version` |
| .NET runtime (tests) | 10.0.12 | `dotnet --list-runtimes` |
| Node.js | v24.19.0 | `node --version` |
| npm | 11.17.0 | `npm --version` |
| Vite / Vitest | 7.3.7 / 4.1.12 | `npm test`/`npm run build` banner |
| Docker | CLI present; **daemon NOT running** (same box as stack-01 verification) | `docker info` |

Backend targets **net10.0** with `TreatWarningsAsErrors=true` (including
NU1902/NU1903 vulnerable-package gates; MessagePack pinned ≥ 2.5.307 and
Microsoft.AspNetCore.SignalR.Client 10.0.13 in tests for GHSA-334f-vvp4-7g6p).

## 2. Backend — `dotnet test` (REAL, PASSED)

Command (exact):

```powershell
cd stacks/35-dotnet9-signalr-react-redis/backend/tests
dotnet test
```

Result: **PASSED, EXIT 0** — 37 tests.

```text
Passed!  - Failed:     0, Passed:    37, Skipped:     0, Total:    37, Duration: 13 s - Stack35.Backend.Tests.dll (net10.0)
```

What the 37 tests cover:

- REST integration via `WebApplicationFactory` (real HTTP semantics through
  TestServer): register 201 + envelope, duplicate email 409 EMAIL_TAKEN,
  weak password 400 WEAK_PASSWORD, validation 400 VALIDATION_ERROR,
  login success + cookie, home protected 401 when anonymous, identical
  INVALID_CREDENTIALS code+message for unknown email vs wrong password (no
  enumeration), login throttle 429 + Retry-After (10 fails / 60 s pinned
  window, success resets), algorithm catalog (4 entries) and run with
  `execution_ms`, unknown algorithm 400 UNKNOWN_ALGORITHM, oversized input
  400 INPUT_TOO_LARGE, `X-Request-Id` header + `request_id` echo, logout
  invalidates the session.
- Unit: algorithm engine (fizzbuzz/palindrome/fibonacci/reverse correctness,
  bounds: fibonacci 1–90, fizzbuzz 1–1000, 10,000-char cap; measured duration
  vs Big-O distinction; catalog safety — no user-code evaluation).
- Real SignalR hub tests over TestServer:
  `HubRejectsUnauthenticatedNegotiate` (POST /hubs/realtime/negotiate → 401),
  `AuthenticatedClientReceivesRunEventsFromRest` (REST algorithm run pushes
  `runEvent` through the authorized hub to a joined `user:{email}` group),
  `PingReceivesPong`.

## 3. Web — `npm test` + build (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/35-dotnet9-signalr-react-redis/frontend
npm.cmd install    # 180 packages, esbuild postinstall held by allow-scripts (binary works)
npm.cmd test       # vitest run
npm.cmd run build  # vite build
```

Results:

```text
npm.cmd test      → Test Files 4 passed (4), Tests 17 passed (17), EXIT 0
npm.cmd run build → vite v7.3.7: ✓ 72 modules transformed, dist/ emitted, EXIT 0
```

The npm CLI exits non-zero only because the local `allow-scripts` policy holds
esbuild's postinstall script; the platform binary itself runs (`esbuild
--version → 0.28.2`), so `vitest run` and `vite build` are unaffected and exit 0.

Coverage: API client envelope handling (success/error/network-synthesis),
Auth page (register/login flows, generic invalid-credentials error), Home
(metrics + server time, 401 alert, unauthenticated redirect), Algorithm page
(catalog load + preselect, 10,000-char input cap with counter, measured
duration vs theoretical Big-O displayed separately, unauthenticated redirect,
catalog-failure alert).

## 4. SignalR realtime path (REAL, partially)

**Verified:** the hub requires authorization (`RequireAuthorization`), unauthenticated
negotiate → 401, and an authenticated client joined to `user:{email}` receives
`runEvent` messages pushed by the REST algorithm run — all as **real
SignalR connections through TestServer** (negotiate/WebSocket routed through
`HttpMessageHandlerFactory`), not mocks.

**UNVERIFIED:** a full browser-based SignalR client session (negotiate →
WebSocket upgrade → UI live-notification rendering) was not exercised against a
running server; the frontend realtime client (`src/api/realtime.ts`) follows the
same protocol and is covered by unit tests only indirectly (client.ts envelope
tests + build). A manual run recipe is in `README.md`.

## 5. Redis backplane (NOT RUN — no server)

**UNVERIFIED — no Redis server is available in this environment and the Docker
daemon is off.** The Redis backplane is *declared, not wired*: the
`Microsoft.AspNetCore.SignalR.StackExchangeRedis` package is referenced by
`Stack35.Backend.csproj`, but `Program.cs` deliberately does not call
`AddStacksRedis(...)` yet — the running code always uses the in-memory hub
lifetime manager (the path the tests exercise). Enabling it is a one-line
change when `ConnectionStrings:Redis` is available; the first real run against
a Redis service must be treated as its verification. `docker-compose.yml`
declares the Redis service as the substrate for that step.

## 6. Docker Compose (NOT RUN — daemon missing)

**UNVERIFIED — `docker info` cannot reach the daemon.** `docker-compose.yml`
(backend + Redis + frontend dev server) is declarative only; the first real
`docker compose up --build` must be treated as its verification run.

## 7. Security review notes

- No secrets committed: `.env.example` uses non-reusable placeholders.
- Credential hashing: PBKDF2 (SHA-256, 100k iterations, per-user salt via
  `Rfc2898DeriveBytes`); never logged or returned.
- Account enumeration blocked: unknown email and wrong password return the
  identical `INVALID_CREDENTIALS` code + message (test-asserted).
- Login throttle: 10 failures / 60 s pinned window per email+IP → 429 +
  `Retry-After`; success resets the tally (test-asserted).
- Cookies: HttpOnly, SameSite=Lax, `SecurePolicy.SameAsRequest`; 401/403
  return JSON instead of login redirects (API contract).
- Algorithm workbench: fixed catalog only; no user-code execution path exists
  (catalog safety unit-tested); input bounded at 10,000 chars, re-validated
  server-side.
- Hub: `[Authorize]` + per-user groups `user:{email}`; no cross-user fan-out.
- Realtime: SignalR hub (authorized, per-user groups) with in-memory fan-out.
  Redis is the declared backplane substrate (package referenced, wiring
  intentionally not implemented — see verification.md §5).
- Vulnerability gates: NU1902/NU1903 treated as errors; vulnerable transitive
  SignalR.Common (GHSA-334f-vvp4-7g6p, ≤10.0.12) avoided by pinning
  Microsoft.AspNetCore.SignalR.Client 10.0.13 in tests; MessagePack ≥ 2.5.307.

## 8. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Redis backplane wiring | **UNVERIFIED** | no Redis server / daemon off; code path declarative |
| docker-compose up | **UNVERIFIED** | Docker daemon not running |
| Browser e2e (Playwright) | not implemented | out of TASK-009 scope |
| Browser SignalR session | **UNVERIFIED** | hub verified over TestServer; no browser client run |
| Automated a11y audit | not implemented | out of TASK-009 scope (labels/roles hand-checked) |
| esbuild postinstall script | held by allow-scripts | binary works; build/test unaffected (see §3) |

## 9. stack.json verification flags

- `manifest`: **true** — validated against `schemas/stack-manifest.schema.json`
  rules (id pattern, required keys, maturity enum, verification booleans,
  category in catalog policy) with a local checker replicating the CI gate.
- `unit`: **true** — algorithm-engine unit tests really ran green.
- `integration`: **true** — REST + real SignalR hub integration tests over
  TestServer really ran green (37/37).
- `e2e`: **false** — no automated browser e2e was run.
- `lastVerifiedAt`: 2026-10-24T20:14:53Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).
