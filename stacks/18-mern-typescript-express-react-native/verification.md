# Verification — Stack 18 (TASK-011)

**Verified at (local):** 2026-10-25, 00:30–01:12 UTC+3
**Branch:** `feat/stack-18-mern-typescript-express-react-native`
**Scope rule:** every claim below is tied to a command that actually ran in this
session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Node.js | v24.19.0 | `node --version` |
| npm | 11.x (nvm4w) | `npm.cmd -v` implicitly via scripts |
| TypeScript | 5.9.3 | `npm ls` (server) |
| Vitest | 2.1.9 | `npm ls` (server/shared/web) |
| Express | 4.21.2 | `npm ls` (server) |
| Mongoose | 8.24.7 | `npm ls` (server) |
| bcryptjs | 3.0.3 | `npm ls` (server) |
| mongodb-memory-server | 10.4.3 (mongod **7.0.14** Windows x64) | `npm ls`, binary `--version` |
| Docker | CLI 29.1.3 present; **daemon not usable** (`docker info` hangs — engine pipe missing) | `docker --version` |
| Expo CLI / Android/iOS SDK | **NOT INSTALLED** | not on PATH |

## 2. Server — `npm test` with a REAL in-process mongod (REAL, PASSED)

Command (exact):

```powershell
cd stacks/18-mern-typescript-express-react-native/server
npm.cmd test    # vitest run (single fork, one real mongod for the suite)
```

Result: **5 test files passed, 60/60 tests passed, EXIT 0**, on a REAL mongod
7.0.14 binary started in-process by mongodb-memory-server (wiredTiger) — no
mocking of the data layer.

```text
 Test Files  5 passed (5)
      Tests  60 passed (60)
```

Suites: auth (15), documents (19), algorithm (11), envelope (10), throttle (5).

What the 60 tests cover:

- `auth` (15): register 201 + envelope, invalid email/weak password 400
  VALIDATION_ERROR with field details, duplicate email 409 EMAIL_TAKEN, login
  200 + HttpOnly SameSite=Lax cookie, generic INVALID_CREDENTIALS (no
  enumeration), unauthenticated 401 for protected routes, logout invalidates
  the session server-side (revoked token → 401), session TTL, X-Request-Id
  echo for valid `^[A-Za-z0-9-]{1,64}$` values and replacement by a fresh
  opaque id for invalid ones.
- `documents` (19): create 201, list with pagination envelope, get 200, update
  200, delete 200, ownership scoping (another user's doc → 404, existence not
  disclosed), invalid id → 400 INVALID_ID, validation errors, empty update →
  400, allow-listed fields only (no `userId` injection via body).
- `algorithm` (11): catalog endpoint, fizzbuzz/reverse/palindrome/fibonacci/
  word-count correctness, measured `executionMs` reported separately from the
  theoretical Big-O, input bounds (oversized → 400 INPUT_TOO_LARGE, unknown
  algorithm → 400 UNKNOWN_ALGORITHM).
- `envelope` (10): `{ok, data, error, requestId}` shape on success and error,
  stable machine-readable error codes + safe human messages, no internal
  leakage in error payloads.
- `throttle` (5): 5 failed logins / 60 s per client → 429 + Retry-After,
  success does not count, window reset, keyed on `req.socket.remoteAddress`
  (XFF deliberately ignored, Stack-01 lesson).

Issues found and fixed during real runs (all resolved, suite green):

1. `require` is undefined inside eval'd `worker_threads` workers started from
   an ESM context (Node 24): the bcrypt worker source now uses
   `await import('node:module')` / `await import('node:worker_threads')` and
   loads bcryptjs via an absolute path passed through `workerData`. Works
   identically under vitest and the compiled `dist/` output.
2. Vitest re-evaluates the module graph per test file, so Mongoose model
   registration must be idempotent (`mongoose.models[name] ?? model(...)`),
   otherwise `OverwriteModelError` kills the second suite.
3. Express 5 `res.clearCookie(..., { maxAge })` deprecation warning: the
   logout cookie-clearing path omits `maxAge` (only sets path/httpOnly/
   sameSite), keeping Express 4 semantics clean.
4. Environment flake (not a code defect): the Windows Temp drive filled up
   (0 bytes free) from 59 orphaned `mongo-mem-*` data directories left by
   crashed/aborted mongod launches, which made mongod abort with
   `fassert() failure — 28: No space left on device`. Cleaning the orphaned
   directories restored a green suite; the test harness itself stops its
   mongod properly.

## 3. Shared layer — `npm test` + type check (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/18-mern-typescript-express-react-native/shared
npm.cmd test          # vitest run
npm.cmd run build     # tsc --noEmit
```

Results:

```text
npm.cmd test      → Test Files 1 passed (1), Tests 15 passed (15), EXIT 0
npm.cmd run build → EXIT 0 (tsc strict clean)
```

Coverage: envelope parsing/normalization (`parseEnvelope`,
`normalizeEnvelope`, `ApiError`), network-failure synthesis into a normal
error envelope, client-side payload bounds. **This is the exact module the
React Native wrapper consumes**, so the RN-relevant logic is verified even
though the RN runtime itself is not (see §6).

## 4. Web — `npm test` + production build (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/18-mern-typescript-express-react-native/web
npm.cmd test          # vitest run (jsdom)
npm.cmd run build     # tsc --noEmit && vite build
```

Results:

```text
npm.cmd test      → Test Files 2 passed (2), Tests 19 passed (19), EXIT 0
npm.cmd run build → tsc clean, ✓ 39 modules transformed, dist/ emitted, EXIT 0
```

Coverage: Register page (accessible labels, submit → navigate, duplicate-email
message, field-level error mapping), Login (generic INVALID_CREDENTIALS
message, throttled message on 429), Home (session load, logout), Algorithm
page (catalog load, run, measured duration shown separately from Big-O),
Documents page (create + list reload). All flows go through the shared API
client — the same code path as the mobile wrapper.

## 5. Runtime smoke against the COMPILED server (REAL, PASSED)

A Node script booted a REAL mongod 7.0.14 (mongodb-memory-server-core,
wiredTiger, port 41050) and the compiled `dist/server.js` (port 4400), then
exercised the live HTTP API end to end. Raw result:

```json
{
  "health": 404,
  "register": 201,
  "requestIdEcho": "smoke-test-id-1",
  "badRequestIdReplaced": true,
  "login": 200,
  "cookieOk": true,
  "home": 200,
  "create": 201,
  "list": 200,
  "update": 200,
  "run": 200,
  "fizzbuzz15": "FizzBuzz",
  "delete": 200,
  "logout": 200,
  "revokedAfterLogout": 401,
  "badLogin": 401,
  "badLoginGeneric": true
}
SMOKE_OK
```

Interpretation: `health: 404` is expected (the server exposes `/api/v1/*`
only; a 404 proves the listener is up). The flow verified register →
X-Request-Id echo + invalid-id replacement → login (HttpOnly SameSite=Lax
cookie set) → home 200 → document create/list/update/delete (201/200/200/200)
→ fizzbuzz(15) = `FizzBuzz` with measured executionMs → logout → old cookie
revoked (401) → wrong password 401 with generic `INVALID_CREDENTIALS`. mongod
was stopped cleanly afterwards (no orphaned data dirs).

## 6. Mobile — Expo wrapper (NOT RUN — SDK missing)

**UNVERIFIED — `expo start` / Metro bundler / emulator COULD NOT BE EXECUTED
because the Expo CLI and Android/iOS SDKs are not installed in this
environment.** No runtime claim is made for `mobile/`. What IS verified: the
shared API-client + envelope layer the wrapper imports passed 15/15 vitest
tests (§3). The wrapper (`mobile/App.tsx`) is written strictly against the
frozen `/api/v1` contract and its README documents the UNVERIFIED status.
First action when an SDK is available: `npm install && npx expo start`.

## 7. Docker (NOT RUN — daemon missing)

**UNVERIFIED** — Docker CLI 29.1.3 exists but the engine is not reachable
(`docker info` hangs), so no container image build or compose run was
attempted. This stack intentionally ships no Dockerfile/compose in this task
(declared out of scope); note kept for honesty about the environment.

## 8. Security review notes

- No secrets committed: `.env.example` uses non-reusable placeholders; no
  runtime secret is required at all — session tokens are per-session OS
  CSPRNG values, only SHA-256 digests are stored, TTL-indexed in Mongo.
- Envelope error responses never include stack traces or internals
  (test-asserted); unexpected exceptions become generic `INTERNAL_ERROR`.
- Passwords: bcryptjs 12 rounds run inside a bounded `worker_threads` pool
  (event loop never blocked); hashes never returned or logged.
- Session fixation: a fresh token is minted on every login; logout deletes
  the digest server-side and clears the cookie (smoke-verified 401 after
  logout with the old cookie).
- Cookie: `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` in TLS deployments via
  config). CSRF posture (Lax + JSON-only state changes + strict CORS
  allowlist) documented in ARCHITECTURE.md.
- Throttle: 5 failed / 60 s per remote address → 429 + Retry-After; XFF
  deliberately ignored (Stack-01 lesson); success clears the tally
  (test-asserted).
- Enumeration defense: unknown email vs wrong password produce identical
  responses (test-asserted).
- Workbench: fixed catalog only (fizzbuzz/reverse/palindrome/fibonacci/
  word-count), no user-code execution path, input bounded (400
  INPUT_TOO_LARGE).
- X-Request-Id: client-supplied ids validated against
  `^[A-Za-z0-9-]{1,64}$`; invalid values are replaced with a fresh opaque id
  and never reflected (Stack-20 lesson; smoke-verified).

## 9. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Expo/Metro runtime (emulator or device) | **UNVERIFIED** | Expo CLI + Android/iOS SDK not installed |
| Mobile type-check (`tsc` over mobile/) | **UNVERIFIED** | no expo/Jest types installed in the workspace; wrapper is plain typed TS against `@shared/*` sources |
| Browser e2e (Playwright) | not implemented | out of TASK-011 scope |
| Automated a11y audit | not implemented | out of scope (labels/roles hand-checked in web tests) |
| Docker run | **UNVERIFIED** | daemon unreachable (and no Dockerfile in scope) |
| Replication/transactions (replica-set mongod) | not exercised | tests run against a standalone mongod; the stack uses single-doc ops only |
| CDN/production serving of web/ | not exercised | dev proxy + build verified only |

## 10. stack.json verification flags

- `manifest`: **true** — structure checked against
  `schemas/stack-manifest.schema.json` (id pattern, category policy, maturity
  enum, versions as version-strings, verification block); CI validate-catalog
  re-checks on the PR.
- `unit`: **true** — server algorithm/envelope/security units and the web +
  shared vitest suites really ran green (94 tests total).
- `integration`: **true** — server auth/documents/throttle suites against a
  real mongod really ran green; compiled-server HTTP smoke (§5) passed.
- `e2e`: **false** — no automated browser or device e2e was run.
- `lastVerifiedAt`: 2026-10-25T21:10:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).
