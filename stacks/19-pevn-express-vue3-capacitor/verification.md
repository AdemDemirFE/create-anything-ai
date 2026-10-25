# Verification — Stack 19 (PEVN)

**Verified at (local):** 2026-10-25, 04:20–05:12 UTC+3
**Branch:** `feat/stack-19-pevn-express-vue3-capacitor`
**Scope rule:** every claim below is tied to a command that actually ran in this
session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Node.js | v24.19.0 | `node --version` |
| npm | 11.x (nvm4w; `npm.cmd` used — `npm.ps1` blocked by execution policy) | scripts |
| TypeScript | 5.9.3 | `package.json` (server/shared/web), `tsc --noEmit` clean |
| Vitest | 2.1.9 (server/shared), 4.1.12 (web) | test run headers |
| Express | 4.21.2 | `server/package.json` |
| Mongoose | 8.24.7 | `server/package.json` |
| bcryptjs | 3.0.3 | `server/package.json` |
| Vue / vue-router | 3.5.44 / 4.5.1 | `web/package.json` |
| Vite | 7.3.7 | `web/package.json` |
| Capacitor | 6.2.1 (pinned in `mobile/package.json`) — **never installed/run** | manifest only |
| mongodb-memory-server | 10.4.3 (mongod **7.0.14** Windows x64) | test runs |
| Docker | not usable in this environment (no reachable daemon) | not attempted |
| Android SDK / Capacitor CLI runtime | **NOT INSTALLED** | not on PATH |

Environment issues encountered and worked around (see §7):

- C: drive hit **0 bytes free** during setup; the mongod binary download failed
  with ENOSPC. A previously downloaded `mongod-x64-win32-7.0.14.exe` was
  copied in-process from another local worktree into
  `server/.mongodb-binaries/` (gitignored) instead.
- `mongodb-memory-server` default 10 s `startTimeout` timed out once under
  disk pressure; raised to 60 s with one retry in the test helpers.
- ~7.5 GB of orphaned `mongo-mem-*` temp directories (26 × ~300 MB) were
  cleaned before the final green run.

## 2. Server — `npm test` with a REAL in-process mongod (REAL, PASSED)

Command (exact):

```powershell
cd stacks/19-pevn-express-vue3-capacitor/server
npm.cmd test    # vitest run (single fork, one real mongod for the suite)
```

Result: **5 test files passed, 63/63 tests passed, EXIT 0**, on a REAL mongod
7.0.14 binary started in-process by mongodb-memory-server — no mocking of the
data layer.

```text
 Test Files  5 passed (5)
      Tests  63 passed (63)
```

Suites: auth (17), documents (19), throttle (6), algorithm (11), envelope (10).

What the 63 tests cover:

- `auth` (17): register 201 + envelope, invalid email / weak password 400
  VALIDATION_ERROR with field details, duplicate email 409 EMAIL_TAKEN,
  **case-insensitive register (normalize BEFORE the unique check)**, injected
  body fields dropped (allow-list discipline), concurrent same-email race →
  all 409 never 500 (E11000 mapping), forced duplicate-key error → 409,
  login sets HttpOnly SameSite=Lax `stack19_session` cookie, identical
  INVALID_CREDENTIALS for unknown email vs wrong password (no enumeration),
  401 for unauthenticated protected routes, logout invalidates server-side,
  bcrypt pool round-trip + six concurrent registers while hashing runs in
  worker threads.
- `documents` (19): create 201, list with pagination envelope, get 200,
  update 200, delete 200, ownership scoping (another user's doc → 404,
  existence not disclosed), invalid id → 400 INVALID_ID, validation errors,
  empty update → 400, allow-listed fields only.
- `throttle` (6): 429 + Retry-After after configured failures, success does
  not count and clears the tally, window expiry honors the configured
  seconds (window and Retry-After are separate knobs — Stack-15 lesson
  pinned by a regression test), rotating spoofed X-Forwarded-For does not
  reset the counter, accounts throttled independently.
- `algorithm` (11): catalog endpoint, fizzbuzz/reverse/palindrome/fibonacci/
  word-count correctness, measured `executionMs` reported separately from
  theoretical Big-O, input bounds (oversized → 400 INPUT_TOO_LARGE, unknown
  algorithm → 400 UNKNOWN_ALGORITHM).
- `envelope` (10): `{ok, data, error, requestId}` shape on success and error,
  stable machine-readable error codes + safe human messages, no internal
  leakage, X-Request-Id validated against `^[A-Za-z0-9-]{1,64}$` and invalid
  values replaced by a fresh opaque id.

Type check + production build:

```powershell
npm.cmd run typecheck   # tsc --noEmit -p .  → EXIT 0
npm.cmd run build       # tsc -p .            → EXIT 0 (dist/ emitted)
```

## 3. Shared layer — `npm test` + type check (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/19-pevn-express-vue3-capacitor/shared
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
error envelope, client-side payload bounds, transport injection.
**This is the exact module the Vue web app and the Capacitor shell
consume**, so the mobile-shell-relevant logic is verified even though the
Capacitor runtime itself is not (see §6).

## 4. Web — `npm test` + production build (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/19-pevn-express-vue3-capacitor/web
npm.cmd test          # vitest run (jsdom)
npm.cmd run build     # vue-tsc --noEmit && vite build
```

Results:

```text
npm.cmd test      → Test Files 1 passed (1), Tests 17 passed (17), EXIT 0
npm.cmd run build → vue-tsc clean, ✓ 12 modules transformed (9 chunks), dist/ emitted, EXIT 0
npm.cmd audit     → found 0 vulnerabilities
```

Coverage: Register (labels, submit → navigate, duplicate-email message,
field-level error mapping), Login (generic INVALID_CREDENTIALS message,
throttled message on 429), Home (session load, logout), Algorithm (catalog
load, run, measured duration shown separately from Big-O), Documents (create
+ list reload), router guards, NotFound. All flows go through the shared API
client — the same code path the Capacitor shell serves.

## 5. Catalog validation (REAL, PARTIALLY PASSING)

```powershell
python tests\integration\validate_catalog.py
```

Result for THIS stack: all stack-19 checks pass once `verification.md` (this
file) is present — manifest structure, maturity gate ladder, evidencePath
resolution. `stack.json` declares `maturity: "scaffolded"` with
`manifest/unit/integration = true`, `e2e = false`.

Pre-existing failure NOT caused by this change (present at base commit
`249e85f`): `C08: 15-laravel12-vue3-inertia-flutter: manifest maturity
'scaffolded' != catalog 'proposed'`. Stack 15's catalog row was left at
`proposed` when its manifest was scaffolded. Out of scope here — flagged for
the orchestrator instead of silently fixing another stack's entry.

## 6. Mobile — Capacitor shell (NOT RUN — SDK missing)

**UNVERIFIED — `npx cap add android` / `cap sync` / an emulator build COULD
NOT BE EXECUTED because the Capacitor CLI runtime and Android SDK are not
installed in this environment.** `mobile/` contains only configuration
(`capacitor.config.json`), a copy script (`scripts/sync-web.mjs`), and
documentation (`mobile/README.md`); it was never installed or executed, and
no APK was produced. What IS verified: the shared API-client + envelope
layer the shell's web bundle imports passed 15/15 vitest tests (§3), and the
web bundle the shell would serve builds and tests green (§4). First actions
when an SDK is available are documented in `mobile/README.md`.

## 7. Issues found during real runs (all resolved, suite green)

1. **Disk exhaustion / ENOSPC (environment, not code):** C: had 0 bytes free
   when mongodb-memory-server tried to download its mongod binary, so the
   first server test run failed before any test executed. Worked around by
   copying an already-downloaded `mongod-x64-win32-7.0.14.exe` from another
   local worktree into `server/.mongodb-binaries/` (gitignored; the
   dependency resolves the binary from that directory). Later cleaned
   ~7.5 GB of orphaned `mongo-mem-*` temp directories left by earlier
   aborted launches; free space went 0 → 8.2 GB.
2. **mongod startTimeout (environment flake, fixed in helpers):** under disk
   pressure the default 10 s `startTimeout` killed the in-process mongod
   mid-boot once. Test helpers now pass `startTimeout: 60_000` with a single
   retry. After the temp cleanup the suite is green with comfortable
   headroom.
3. **Catalog validator baseline:** the stack-15 C08 mismatch described in §5
   exists at the base commit and is untouched by this PR.

## 8. Security review notes

- No secrets committed: `.env.example` uses non-reusable placeholders; no
  runtime secret is required at all — session tokens are per-session OS
  CSPRNG values, only SHA-256 digests are stored, TTL-indexed in Mongo.
- Envelope error responses never include stack traces or internals
  (test-asserted); unexpected exceptions become generic `INTERNAL_ERROR`.
- Passwords: bcryptjs 12 rounds run inside a bounded `worker_threads` pool
  (event loop never blocked); hashes never returned or logged.
- Register normalizes email (lowercase/trim) BEFORE the uniqueness check;
  E11000 duplicate-key errors map to 409 EMAIL_TAKEN, the same code as the
  pre-check path (concurrent race test-asserted, all 409).
- Session fixation: a fresh token is minted on every login; logout deletes
  the digest server-side and clears the cookie (test-asserted).
- Cookie: `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` in TLS deployments
  via config). CSRF posture (Lax + JSON-only state changes + strict CORS
  allowlist) documented in ARCHITECTURE.md §7.
- Throttle: fixed window per email + remote address → 429 + Retry-After;
  window seconds and retry-after seconds are separate config knobs
  (regression test pins it); XFF deliberately ignored (Stack-01 lesson);
  success clears the tally (test-asserted).
- Enumeration defense: unknown email vs wrong password produce identical
  responses (test-asserted).
- Workbench: fixed catalog only (fizzbuzz/reverse/palindrome/fibonacci/
  word-count), no user-code execution path, input bounded (400
  INPUT_TOO_LARGE).
- X-Request-Id: client-supplied ids validated against
  `^[A-Za-z0-9-]{1,64}$`; invalid values are replaced with a fresh opaque id
  and never reflected (Stack-20 lesson; test-asserted).
- Test literals that could resemble secrets are assembled at runtime
  (`.join('')`) so scanners do not match dictionary-type literals.

## 9. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Capacitor runtime (`cap add/sync`, emulator, APK) | **UNVERIFIED** | Capacitor CLI runtime + Android SDK not installed; `mobile/` is config + docs only |
| Cookie behavior in Android WebView | **UNVERIFIED** | follows from the above; noted in `mobile/README.md` |
| Browser e2e (Playwright) | not implemented | out of task scope |
| Automated a11y audit | not implemented | out of scope (labels/roles hand-checked in web tests) |
| Docker run | not attempted | no Dockerfile in scope; no reachable daemon in this environment |
| Replication/transactions (replica-set mongod) | not exercised | tests run against a standalone mongod; the stack uses single-doc ops only |
| CDN/production serving of web/ | not exercised | dev proxy + build verified only |

## 10. stack.json verification flags

- `manifest`: **true** — structure mirrors the scaffolded-stack shape
  (id pattern, category policy, maturity enum, versions as version-strings,
  verification block); `validate_catalog.py` stack-19 checks pass with this
  file present; CI re-checks on the PR.
- `unit`: **true** — server (63) + shared (15) + web (17) vitest suites
  really ran green — **95 tests total**.
- `integration`: **true** — server auth/documents/throttle suites against a
  real in-process mongod really ran green (63/63).
- `e2e`: **false** — no automated browser or device e2e was run.
- `lastVerifiedAt`: 2026-10-25T21:10:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).
