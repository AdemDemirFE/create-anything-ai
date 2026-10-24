# Stack 20 Architecture — FastAPI + React (Vite) PWA

## 1. Identity and maturity

- **ID:** `20-fastapi-react-vite-pwa`
- **Name:** FastAPI / React / Vite / PWA
- **Category:** `classic-web`
- **Maturity:** `scaffolded` (see verification.md for gate-by-gate evidence)
- **Owner:** TASK-008 reference implementation session
- **Last verified (UTC):** 2026-10-24
- **Supported OS (tested):** Windows 11 (backend + web)
- **License notes:** FastAPI/MIT, Starlette/BSD-3, React/MIT, Vite/MIT,
  bcrypt/Apache-2.0 (Python binding), uvicorn/BSD-3. No license conflicts.

## 2. Technology and compatibility matrix

| Component | Target version | Tested version | Support evidence |
|---|---|---|---|
| Language (backend) | Python 3.13+ | 3.13.2 | `python --version`, real pytest run |
| Backend framework | FastAPI 0.129 | 0.129.0 | pinned in requirements.txt, real tests |
| ASGI server | uvicorn 0.41 | 0.41.0 | pinned; run command documented |
| Password hashing | bcrypt 4.3 (direct, off-loop) | 4.3.0 | real register/login/throttle/concurrency tests |
| Web framework | React 19 | 19.2 | package.json, real vitest + build |
| Build tool | Vite 7 | 7.3.7 | real `npm run build` (exit 0) |
| Test runners | pytest 9.1 / vitest 4.1 | 9.1.1 / 4.1.12 | real runs (78 + 19 tests) |

**Dependency decision — passlib replaced by direct `bcrypt`:** the task
brief suggested passlib/bcrypt. passlib 1.7.4 (last release 2020) reads
`bcrypt.__about__.__version__`, removed in bcrypt 4.1+, which emits a noisy
"(trapped) error reading bcrypt version" traceback on every hash call. This
stack calls the maintained `bcrypt` library directly with the same `$2b$`
format, 12 rounds, automatic salts, and SHA-256 pre-hashing for inputs
longer than bcrypt's 72-byte limit (avoids silent truncation). The decision
is documented here and in `app/security.py` docstrings.

**Event-loop decision (review round 1, finding 1):** bcrypt is deliberately
CPU-bound (~100-300 ms at 12 rounds). All hash/verify calls from the
`async def` route handlers run in a dedicated bounded `ThreadPoolExecutor`
(`hash_password_async` / `verify_password_async` via `run_in_executor`), so
a slow hash never blocks other requests. `tests/test_concurrency.py` proves
it: a `/api/v1/health` probe completes well before an in-flight register's
hash finishes, and four parallel registers all succeed. Unknown-email
logins also burn one verification against a fixed non-secret throwaway
hash to equalize response timing (enumeration-via-latency defense).

## 3. Architecture

### Process boundaries

- One backend process (uvicorn, port 8000). The React SPA is a separate
  static build (dev :5173, preview :4173) proxied to the same origin, so the
  session cookie is always first-party.
- Clients never touch storage; the REST API is the only trust boundary.

### Module layout

```text
backend/app/
├── main.py                # app factory, middleware, handler wiring
├── config.py              # env-overridable settings (no secrets)
├── store.py               # thread-safe in-memory users/sessions/throttle
├── security.py            # bcrypt hashing + CSPRNG session tokens
├── api/
│   ├── routes.py          # /api/v1 endpoints + 401/422 envelope handlers
│   └── schemas.py         # request/response DTOs (aliases for camelCase)
├── auth/
│   ├── sessions.py        # cookie lifecycle (HttpOnly, SameSite=Lax)
│   └── throttle.py        # failed-login rate limiting → 429
├── algorithm/
│   └── catalog.py         # fixed, bounded algorithm catalog
└── web/
    ├── envelope.py        # §7 envelope builders + monotonic measurement
    └── error_codes.py     # stable error code strings
```

### API boundary and DTOs

All endpoints wrap every response in the repository envelope
(docs/PRODUCT_REQUIREMENTS.md §7): `success` / `data` / `error` / `meta`
with `timestamp` and `request_id`; `execution_ms` only where measured
(algorithm runs). Response DTOs serialize with camelCase aliases
(`algorithmId`, `executionMs`, `serverTime`) to match the frozen SPA
contract. Correlation id also flows back via `X-Request-Id`.

**X-Request-Id validation (review round 1, finding 3):** a client-supplied
`X-Request-Id` is honored only when it matches `^[A-Za-z0-9-]{1,64}$`;
anything else (too long, whitespace, control characters — header-injection
and log-forging vectors; httpx also refuses non-ASCII header values at the
transport layer) is discarded and a fresh opaque 32-hex id is generated
instead. The validated value is what appears both in the response header
and in every envelope's `meta.request_id` (test-asserted in
`tests/test_envelope.py`).

Stable error codes: `VALIDATION_ERROR`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`,
`RATE_LIMITED`, `UNAUTHORIZED`, `UNKNOWN_ALGORITHM`, `INPUT_TOO_LARGE`,
`INVALID_INPUT`, `INTERNAL_ERROR`. FastAPI's 422 responses are re-wrapped
into `VALIDATION_ERROR` envelopes with field details; authentication
failures become `UNAUTHORIZED` envelopes (401), never bare `detail` objects.

### Persistence

- **In-memory store** (`store.py`): users, sessions, and throttle tallies in
  process memory guarded by an `RLock`. Chosen deliberately so the reference
  stack runs with `pip install -r requirements.txt` and zero services.
- Data is lost on restart; there are no migrations. A SQLite swap-in keeps
  the same interface (`MemoryStore` method surface) — noted as a natural
  follow-up, not claimed as present.

### Auth/session model (the documented decision)

- **Server-side sessions, not JWT.** Logout must invalidate immediately and
  server-side (`logoutInvalidatesSession` is test-asserted); stateless JWTs
  would need a denylist — server-side state with extra machinery. No
  cross-service token exchange exists at this scope.
- **Cookie:** `STACK20_SESSION`, HttpOnly, SameSite=Lax, path `/`.
  The `Max-Age` sent to the browser is 1800 s, refreshed on every
  authenticated response-issuing call (login). Server-side, expiry is an
  **idle timeout (sliding window, review round 1 finding 2):** every
  authenticated request calls `STORE.refresh_session`, which re-anchors
  `expires_at` at `now + 1800 s`; 30 minutes **without any request**
  expires the session even minutes after login. Activity resets the timer
  (test-asserted in `tests/test_session_ttl.py`: 2/3 TTL + activity + 2/3
  TTL stays alive; TTL without activity dies). `Secure` flag is enabled by
  setting `SECURE_COOKIES=1` behind TLS (documented, off in dev by design).
- **Tokens:** 32 bytes from the OS CSPRNG (`secrets.token_hex`), stored only
  as a SHA-256 digest; the raw token lives only in the cookie and is never
  logged. Forged/unknown cookies simply fail resolution → 401 (test-asserted).
- **Passwords:** bcrypt (12 rounds) with per-hash salts, hashed at
  registration, never returned or logged (test-asserted for every response).
- **Login throttle:** 5 **failed** attempts per pinned 60 s window, keyed on
  email + direct connection peer. X-Forwarded-For is deliberately ignored
  (untrusted without a trusted-proxy config; rotating it would defeat the
  limit). Exceeding the limit returns **HTTP 429 + `Retry-After: 60`** and
  stays 429 even with correct credentials until the window expires. Success
  never counts and clears the tally (all test-asserted). Demo-grade,
  documented as such; production should enforce limits at the edge.
- **Enumeration defense:** unknown email and wrong password return identical
  code + message + status (test-asserted).
- **CSRF strategy:** SameSite=Lax cookies + strict CORS allowlist
  (credentials enabled) instead of double-submit tokens. Justification:
  the SPA is same-origin (dev proxy / static host), state-changing calls are
  JSON-only (`Content-Type: application/json` is not a simple request, so
  cross-site forms cannot trigger them without CORS approval), and the
  allowlist denies every other origin (test-asserted preflight behavior).
  Trade-off reviewed as adequate for a reference stack; document per
  deployment if cookies ever become cross-site.
- **CORS:** explicit allowlist from `ALLOWED_ORIGINS`
  (default localhost:5173/4173 + 127.0.0.1:5173), credentials enabled,
  methods GET/POST/OPTIONS only.

### Algorithm workbench

- Fixed catalog of five algorithms (fizzbuzz, reverse, palindrome,
  fibonacci, word-count). **No user code is ever executed** — input is data
  only; the source itself carries no `eval`/`exec` (unit-asserted).
- Input bound: 10,000 chars, enforced in the request schema (min), route
  (400 `INPUT_TOO_LARGE`), and engine (defense in depth). Oversized inputs
  are rejected **before** execution.
- Numeric algorithms have semantic bounds (fizzbuzz n ≤ 1000, fibonacci
  n ≤ 90) and return 400 `INVALID_INPUT` when violated.
- Measured duration uses `time.perf_counter_ns()` (monotonic) and is
  reported in `meta.execution_ms` **and** `data.executionMs`; the
  theoretical Big-O is a static catalog string shown separately by the UI.
  The two concepts are never conflated (unit-asserted).

## 4. Four-screen mapping

| Requirement | Implementation path/screen | Server-side protection | Tests |
|---|---|---|---|
| Register | web `RegisterPage` | validation, bcrypt, unique email, 409 duplicate | `TestRegister` (6) + RegisterPage tests |
| Login | web `LoginPage` | throttle → 429, generic failure, session cookie | `TestLogin` (6) + LoginPage tests |
| Home | web `HomePage` | backend session required; 401 otherwise | `TestProtected` (5) + HomePage tests |
| Algorithm workbench | web `AlgorithmPage` | session required; fixed catalog; bounded input | `TestAlgorithmWorkbench` (7) + AlgorithmPage tests |
| Logout/revocation | web navbar action | server-side session invalidation | `TestLogoutAndRevocation` (2) |

## 5. Environment variables

| Name | Purpose | Required | Default | Secret |
|---|---|---|---|---|
| `SECURE_COOKIES` | enable Secure cookie flag (TLS deployments) | no | empty | no |
| `ALLOWED_ORIGINS` | CORS allowlist override | no | localhost dev set | no |

No other configuration exists; there are no database credentials, no API
keys, and no committed secrets (`.env.example` carries placeholders only).

## 6. Local setup

See README.md (exact tested commands for venv + pip + pytest and npm
install/test/build/dev/preview). Startup: backend on :8000, then either
`npm run dev` or `npm run preview`; both proxy `/api` to :8000.

## 7. Security

- Input validation: Pydantic schemas with `extra="forbid"`, explicit length
  bounds; validation errors re-wrapped as envelope `VALIDATION_ERROR`.
- AuthN: bcrypt + HttpOnly/SameSite=Lax session cookies; raw tokens never
  stored server-side.
- AuthZ: every non-public endpoint requires a valid session (dependency);
  401 envelopes otherwise (test-asserted per endpoint).
- CORS: allowlist + credentials; unknown origins rejected (test-asserted).
- Rate limits: login throttle 5/min per email+IP (demo-grade, documented).
- Uploads: none (no multipart endpoints exist).
- Secrets: none committed; none required at runtime.
- Logging: passwords/tokens/cookies never logged; unexpected errors return
  a generic `INTERNAL_ERROR` envelope while the traceback stays server-side.
- Dependency scanning: repository CI Gitleaks covers the diff; per-stack
  Dependabot config is out of TASK-008 scope.

## 8. Testing and acceptance

- Unit: `test_algorithm.py` (19), `test_security_store.py` (11),
  `test_envelope.py` (11) — real runs.
- Integration (TestClient): `test_api_integration.py` (27) covering the four
  journeys, 401/429 paths, envelope contract, CORS, and enumeration defense.
- Concurrency (anyio + httpx.AsyncClient): `test_concurrency.py` (5) —
  event-loop non-blocking under slow hashes (review finding 1).
- Session TTL: `test_session_ttl.py` (5) — idle-window semantics (review
  finding 2).
- Web: `client.test.ts` (5), `Auth.test.tsx` (7), `Algorithm.test.tsx` (3),
  `pwa.test.ts` (4) — real vitest run; `npm run build` (tsc + vite) real.
- UI/e2e: not automated in this task (documented gap).
- Accessibility: labeled inputs, `role="alert"`, `aria-busy`/`aria-live`
  used; no automated a11y audit — documented gap.

## 9. Operational readiness

- Health: `GET /api/v1/health` (public, trivial JSON, envelope-less).
- Logs: default uvicorn console logs; no request bodies logged anywhere.
- Graceful shutdown: uvicorn SIGINT/SIGTERM default behavior.
- Backup/restore: not applicable to in-memory reference data (documented).
- Metrics: none yet; observability is an explicit follow-up.

## 10. Agent task plan (implemented by TASK-008)

| Task | Scope | Status |
|---|---|---|
| TASK-008a | FastAPI backend + auth + throttle + tests | done (78/78 real; review round 1 fixes incl.) |
| TASK-008b | React + Vite PWA frontend, 4 screens, vitest + build | done (19/19 + build real) |
| TASK-008c | verification.md + stack.json + catalog entry | done (evidence-based) |
| TASK-008d | Docker/e2e/mobile | not in scope for this stack |
