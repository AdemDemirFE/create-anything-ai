# Verification — Stack 20 (TASK-008)

**Verified at (local):** 2026-10-24, 22:45–23:00 UTC+3
**Branch:** `feat/stack-20-fastapi-react-vite-pwa`
**Scope rule:** every claim below is tied to a command that actually ran in
this session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Python | 3.13.2 | `python --version` |
| pip | 25.3 | `pip --version` |
| Node.js | v24.19.0 | `node --version` |
| npm | bundled with Node 24 | `npm.cmd install` runs |
| Docker | CLI 29.1.3 present; **daemon NOT started/not exercised** | not used by this stack (see gaps) |
| gh CLI | logged in as AdemDemirFE | `gh auth status` |

Dependency versions are **pinned** in `backend/requirements.txt`
(fastapi 0.129.0, uvicorn 0.41.0, pydantic[email] 2.12.5, bcrypt 4.3.0,
pytest 9.1.1, httpx 0.28.1). Availability of every pin was checked against
PyPI (`pip index versions …`) before pinning, and the install below is the
proof they resolve. Web deps are lockfile-pinned (`package-lock.json`).

**passlib decision:** the brief suggested passlib/bcrypt. passlib 1.7.4
(last release 2020) is incompatible with bcrypt ≥ 4.1 (`__about__` removed →
"(trapped) error reading bcrypt version" traceback on every call — observed
live during the first smoke run). The stack therefore calls `bcrypt` 4.3.0
directly, same `$2b$` format, 12 rounds, SHA-256 pre-hash for >72-byte
inputs. Decision documented in ARCHITECTURE.md §2 and `app/security.py`.

## 2. Backend — `python -m pytest` (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/20-fastapi-react-vite-pwa/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest
```

Result: **64 passed, 0 failed, 2 warnings (starlette deprecations in the
TestClient library itself), EXIT 0** — in ~29 s.

```text
64 passed, 2 warnings in 28.86s
```

Coverage by file:

- `test_algorithm.py` (19): fixed-catalog content and safety (no eval/exec/
  `__import__` in the module — asserted via source inspection), correctness
  for all five algorithms, input bounds (oversized → `InputTooLargeError`,
  at-cap accepted, unknown id → KeyError), numeric range rejections, and the
  measured-duration-vs-Big-O distinction (complexity is a static spec field;
  duration only ever comes from the monotonic clock at the route layer).
- `test_security_store.py` (11): bcrypt roundtrip, wrong-password failure,
  salted uniqueness, long-password pre-hash (no silent 72-byte truncation),
  malformed-hash → clean failure, 256-bit CSPRNG tokens, digest-only
  storage, session expiry (monkeypatched clock), throttle window/reset.
- `test_envelope.py` (7): the §7 envelope contract — exact top-level keys,
  meta timestamp/request_id, error shape with stable codes, `data: null`
  preserved, `execution_ms` present only where measured and equal to
  `data.executionMs`, `X-Request-Id` correlation, validation details carry
  field-level codes.
- `test_api_integration.py` (27, FastAPI TestClient): register 201 +
  invalid email/weak password 422 + duplicate 409 without leakage; login
  success + cookie flags (`STACK20_SESSION`, `HttpOnly`, `SameSite=lax`
  asserted on the wire), generic invalid-credentials, unknown-email vs
  wrong-password indistinguishability (enumeration defense), **throttle:
  5×401 then 429 + Retry-After, 429 even with correct password, success
  clears the tally**; protected `/home`, `/me`, `/algorithm`,
  `/algorithm/run` all 401 unauthenticated; home payload when authed;
  logout invalidates server-side and a forged cookie never authenticates;
  workbench catalog/run/unknown-algorithm/INPUT_TOO_LARGE/INVALID_INPUT/
  at-cap accepted; CORS preflight allowlist (5173 allowed, evil.example
  rejected); password string never appears in any response body.

Issues found and fixed during real runs (all resolved, suite green):

1. FastAPI 0.129 does not re-export `RequestValidationError` from the
   package root (unlike older docs) — imports moved to
   `fastapi.exceptions`.
2. passlib 1.7.4 × bcrypt 4.3 incompatibility (see §1) — replaced with
   direct bcrypt usage; the observed "(trapped)" traceback is gone.
3. Envelope responses built with `Response(...)` lost the `Set-Cookie`
   set on the injected `response` parameter — session cookies are now
   attached to the exact envelope Response that the handler returns
   (verified by the cookie-flags test).
4. Pydantic `max_length=10_000` on the run input turned oversized payloads
   into 422; the contract wants the specific 400 `INPUT_TOO_LARGE`, so the
   bound is enforced in the route + engine (schema documents the decision).

## 3. Frontend — `npm test` + `npm run build` (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/20-fastapi-react-vite-pwa/frontend
npm.cmd install          # exit 0 (lockfile; esbuild postinstall pending-allow warning only)
npm.cmd test             # vitest run
npm.cmd run build        # tsc --noEmit && vite build
```

Results:

```text
npm.cmd test        → Test Files 4 passed (4), Tests 19 passed (19), EXIT 0
npm.cmd run build   → tsc clean + ✓ 44 modules transformed, EXIT 0
                      dist/: index.html, assets/index-*.js (268.50 kB),
                      sw.js, manifest.webmanifest, icons/ (3 PNGs)
```

Coverage: API client envelope handling (success/error/429/offline-
synthesis/bounded payloads), Register (labels, submit, duplicate-email
alert), Login (generic error + 429 throttled message), Home (loading → data
→ logout, 401 handling, error state), Algorithm (catalog load, input cap
attribute, measured time vs Big-O shown separately, INPUT_TOO_LARGE alert,
401 prompt), PWA registration (production-only, dev skip, failure-swallow,
no-listener assertions).

Issues found and fixed during real runs: vitest's `import.meta.env` proxy
reads `process.env.DEV`, and a leaked `load` listener from the production
test fired in the dev-skip test — the test now spies/stubs and cleans up
listeners per test (product code was already correct).

## 4. PWA (declarative + build-verified; runtime install UNVERIFIED)

- `public/manifest.webmanifest` (valid JSON, standalone, icons 192/512/
  maskable) and `public/sw.js` (documented strategy: stale-while-revalidate
  for the shell, network-only for `/api/*`, non-GET never intercepted,
  versioned cache with activate-time purge) are emitted into `dist/` by the
  real build above and linked from `index.html`.
- **UNVERIFIED in a real browser install/audit** (no browser e2e in this
  task's scope): Lighthouse installability, offline page behavior, and SW
  update flow were not executed. First action when exercised: serve
  `npm run preview` over localhost and run a Lighthouse PWA audit.

## 5. Runtime smoke (REAL, PASSED)

A TestClient-based end-to-end pass over the live app object ran during
development (register 201 → login 200 + Set-Cookie → home 200 → catalog 200
→ run 200 with `executionMs` → logout (cookie cleared) → home 401
`UNAUTHORIZED`). The same paths are covered by the committed integration
suite, which is the durable evidence.

## 6. Security review notes

- No secrets committed: `.env.example` has non-reusable placeholders; no
  runtime secret is required at all (per-process CSPRNG session tokens).
- Envelope error responses never include stack traces or internals
  (test-asserted); unexpected exceptions are caught and returned as generic
  `INTERNAL_ERROR`.
- Passwords: bcrypt 12 rounds, salted, pre-hashed when >72 bytes; never
  returned or logged (test-asserted across register/login bodies).
- Session fixation: a fresh token is minted on every login; logout
  invalidates server-side and the cookie is cleared (test-asserted).
- Throttle: 5 failed / 60 s per email+IP → 429 + Retry-After; XFF ignored
  (untrusted peer control); success clears the tally (all test-asserted).
- CSRF decision: SameSite=Lax + strict CORS + JSON-only state changes;
  rationale and trade-offs in ARCHITECTURE.md §3 (reviewed).
- Enumeration defense: unknown email vs wrong password identical responses
  (test-asserted).
- Workbench: fixed catalog only, no user-code execution path (source-scan
  test), input bounded at 10,000 chars with 400 INPUT_TOO_LARGE.

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Browser PWA runtime (Lighthouse install, offline SW behavior) | **UNVERIFIED** | no browser e2e in TASK-008 scope; manifest+SW are build-emitted but never executed in a browser |
| Docker | not applicable / not exercised | this stack has no compose file; daemon also unavailable |
| SQLite persistence variant | not implemented | in-memory store is the documented reference choice; interface allows swap-in |
| Automated a11y audit | not implemented | out of scope (labels/roles hand-checked) |
| Browser e2e (Playwright) | not implemented | out of TASK-008 scope |
| Backend hot-reload run (`uvicorn --reload`) | not run | TestClient + integration suite cover the app; actual port bind not exercised in this session |

## 8. stack.json verification flags

- `manifest`: **true** — structure checked against
  `schemas/stack-manifest.schema.json` (id pattern, category policy,
  maturity enum, versions as version-strings, verification block); CI
  validate-catalog re-checks on the PR.
- `unit`: **true** — pytest unit files (algorithm/security/envelope) really
  ran green; web vitest suite really ran green.
- `integration`: **true** — `test_api_integration.py` (TestClient) really
  ran green.
- `e2e`: **false** — no automated browser e2e was run.
- `lastVerifiedAt`: 2026-10-24T19:57:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).
