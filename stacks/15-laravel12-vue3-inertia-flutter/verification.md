# Verification — Stack 15 (TASK-015)

**Verified at (local):** 2026-10-25, 00:00–03:00 UTC+3 (approx.; single
session)
**Branch:** `feat/stack-15-laravel12-vue3-inertia-flutter`
**Scope rule:** every claim below is tied to a command that actually ran in
this session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| PHP | 8.3.33 (CLI) | `php -v` |
| Composer | 2.10.3 | `composer --version` |
| Node.js | v24.19.0 | `node --version` |
| Laravel | 12.70.1 (`laravel/framework`) | `composer.lock` |
| Inertia (server) | inertiajs/inertia-laravel v3.5.2 | `composer.lock` |
| Vue | 3.5.44 / @inertiajs/vue3 2.3.29 | `package-lock.json` |
| Vite | 8.3.5 / laravel-vite-plugin 3.2.0 | `package-lock.json` |
| PHPUnit | 11.5.57 | `composer.lock` |
| Vitest | 5.0.5 | `package-lock.json` |
| Flutter SDK | **NOT INSTALLED** (`flutter` not recognized) | PowerShell |

**Environment workaround (this machine):** the system `php.ini`
(`C:\tools\php83\php.ini`) ships without `pdo_sqlite`/`sqlite3`. All PHP
commands in this session ran with
`PHPRC=C:\Users\ademir\AppData\Local\Temp\opencode\stack15-php.ini`, a
session-scoped ini that mirrors the system config plus the SQLite drivers.
It is NOT installed system-wide and NOT part of the repo. On a normal
Laravel dev machine (pdo_sqlite enabled) no workaround is needed.
Consequence: `php artisan test` FAILS in this environment (the Collision
subprocess drops `PHPRC` → "could not find driver"); the documented run
command is the direct PHPUnit binary below. `php artisan serve` also failed
to bind ports on this box ("Failed to listen on 127.0.0.1:8000 (reason: ?)"
with no bind conflict); the smoke run used PHP's built-in server directly
(§4).

## 2. Backend — PHPUnit (REAL, PASSED)

Command (exact):

```powershell
cd stacks/15-laravel12-vue3-inertia-flutter/laravel
$env:PHPRC='C:\Users\ademir\AppData\Local\Temp\opencode\stack15-php.ini'
composer install                 # exit 0, clean
composer validate                # ok
php vendor\phpunit\phpunit\phpunit
```

Result: **OK (49 tests, 245 assertions)**, exit 0.

```text
OK (49 tests, 245 assertions)
```

Coverage by file:

- `EnvelopeContractTest` — the `/api/v1` envelope shape: success
  `{ok,data,error:null,requestId}`, failure with stable code + field
  details, requestId echoed in header AND body, defensive rendering for
  unexpected exceptions (no stack traces/SQL in responses).
- `AuthFlowTest` — register 201 (+ envelope + cookie), invalid
  email/password 422 `VALIDATION_ERROR` with field details, duplicate email
  422 (field-level, no enumeration wording), generic
  `INVALID_CREDENTIALS` for unknown email AND wrong password (identical
  bodies), unauthenticated 401 `UNAUTHENTICATED`, logout invalidates the
  session server-side.
- `LoginThrottleTest` — 5 failed logins then 429 `RATE_LIMITED` +
  `Retry-After` header; correct password does NOT bypass the lockout;
  success clears the tally; only failures consume the budget; lockout keyed
  per email+IP.
- `NoteCrudTest` — notes CRUD over `/api/v1` (201/200/200/200), ownership
  403 `FORBIDDEN` for foreign notes, validation bounds (title 120, body
  5000 → 422), Inertia page variants render.
- `AlgorithmApiTest` — fixed catalog, run output + measured `execution_ms`
  separate from static `complexity`, unknown id 400 `UNKNOWN_ALGORITHM`,
  oversized input 400 `INPUT_TOO_LARGE` (at-cap accepted), input never
  executed.
- `ScreenContractTest` — Inertia page props for all four screens (Welcome,
  Dashboard, Notes index/show/form, Algorithm workbench).
- `ApiMiddlewareWiringTest` — regression guard for the CSRF fix (§2b):
  `/api/v1` routes are in the `api` group only (no `ValidateCsrfToken`,
  with `throttle:api` present), web routes keep CSRF.

## 2b. Runtime smoke found a real CSRF wiring bug (FIXED, re-verified)

The first smoke run (§4) failed 42/53 checks: every `/api/v1` write
returned **419 `CSRF_TOKEN_MISMATCH`** over real HTTP. Root cause: the API
routes had been declared inside `routes/web.php` and therefore ran under
the `web` middleware group (`ValidateCsrfToken`), while the custom `api`
group in `bootstrap/app.php` was dead code. The PHPUnit suite did not catch
this because Laravel's `ValidateCsrfToken::runningUnitTests()` silently
disables CSRF verification under phpunit — a genuine test blind spot for
middleware wiring.

Fix (all in-repo, suite re-run green afterwards):

1. `/api/v1` moved to `routes/api.php`, mounted via
   `withRouting(api: ..., apiPrefix: 'api/v1')` → framework wraps it in the
   (custom) `api` group automatically. `routes/web.php` no longer declares
   any `api/*` route.
2. The `api` group keeps the documented shape: session-cookie auth
   (EncryptCookies + StartSession), **no CSRF**, `throttle:api`,
   SubstituteBindings.
3. `throttle:api` limiter registered in `AppServiceProvider::boot()`
   (240/min per user-or-IP — coarse guard; the strict failed-login limiter
   is unchanged).
4. New `tests/Feature/ApiMiddlewareWiringTest.php` (3 tests) pins the
   wiring: api routes resolve to the `api` group (no CSRF middleware,
   throttle present), web register route keeps `ValidateCsrfToken`.
   Note: group expansion required resolving the HTTP kernel in the test
   (the router only receives the group map when the kernel resolves).

Full suite after the fix: **OK (49 tests, 245 assertions)** (46 original +
3 wiring tests).

## 3. Web build + vitest (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/15-laravel12-vue3-inertia-flutter/laravel
npm.cmd ci                      # exit 0
npm.cmd audit                   # 0 vulnerabilities
npm.cmd test                    # vitest run (LARAVEL_BYPASS_ENV_CHECK=1 via cross-env)
npm.cmd run build               # vite build
```

Results:

```text
npm.cmd audit    → found 0 vulnerabilities
npm.cmd test     → Test Files 3 passed (3), Tests 7 passed (7), EXIT 0
npm.cmd run build→ ✓ built in ~740ms, public/build/ emitted, EXIT 0
```

Coverage: envelope normalization (`envelope.test.ts`: success unwrap,
failure code/message/details, UNKNOWN fallback for foreign bodies, empty
requestId) — the same rules the Dart client mirrors — plus Vue page tests
(auth form submission and list rendering against mocked fetch).

Note: `public/build/` is a deploy artifact and gitignored; feature tests
call `withoutVite()` globally (`tests/TestCase.php`) so they never depend
on it.

## 4. Runtime smoke over real HTTP (REAL, PASSED)

Command (exact):

```powershell
cd stacks/15-laravel12-vue3-inertia-flutter/laravel
$env:PHPRC='C:\Users\ademir\AppData\Local\Temp\opencode\stack15-php.ini'
php artisan migrate:fresh --force
cd public
php -S 127.0.0.1:8092 index.php          # background
cd ..
node scripts\smoke.mjs                   # SMOKE_BASE_URL=http://127.0.0.1:8092
```

(`php artisan serve` was tried first but cannot bind ports in this
environment; PHP's built-in server with Laravel's `public/index.php`
router serves the identical application. On a normal machine
`php artisan serve --port=8000` + `SMOKE_BASE_URL=http://127.0.0.1:8000`
is equivalent.)

Result: **53/53 checks passed, SMOKE PASSED, exit 0.**

What the 53 checks cover (in order):

- `/api/v1/health` 200 with strict envelope shape.
- X-Request-Id: valid id echoed in header AND envelope body; oversized
  (80-char) id discarded and replaced by an opaque 32-hex id in both.
- Register 201 (+ user payload); duplicate register 422 with
  `error.details[].field = "email"` and no account-existence wording;
  invalid fields 422 `VALIDATION_ERROR`.
- Unauthenticated `/notes` 401 `UNAUTHENTICATED`.
- Wrong password 401 generic `INVALID_CREDENTIALS` (message is the
  enumeration-safe generic).
- Login 200 + `stack15_session` cookie captured.
- Notes: create 201, list contains it, update persists, show returns
  updated body.
- Foreign note read (second registered user) → 403 `FORBIDDEN`.
- Workbench: catalog + `maxInputLength = 10000`; reverse run output
  `dlrow olleh` with numeric `execution_ms` and `complexity: "O(n)"`;
  unknown algorithm 400 `UNKNOWN_ALGORITHM`; oversized input 400
  `INPUT_TOO_LARGE`.
- Throttle: 5 failed logins → 6th returns 429 `RATE_LIMITED` with
  `Retry-After > 0`; a different account's login is unaffected (per-email
  keying).
- Logout 200 (`logged_out: true`); post-logout `/notes` with the same
  cookie → 401 (server-side revocation).

Issues found and fixed during the smoke run (all resolved, re-run green):

1. The CSRF wiring bug — full story in §2b (routes moved to
   `routes/api.php`, wiring regression test added).
2. Smoke script bug: the cookie jar never captured `Set-Cookie` headers
   (`jar.capture(res)` was not called), so session-dependent checks failed
   with 401 after login passed — fixed in `scripts/smoke.mjs` itself (test
   harness, not app code).

## 5. Mobile — Flutter (NOT RUN — SDK missing)

**UNVERIFIED — `flutter pub get` / `flutter analyze` / `flutter test`
COULD NOT BE EXECUTED because the Flutter SDK is not installed in this
environment.** No version, build, or test claim is made for `mobile/`. The
Dart code is written strictly against the frozen envelope contract (see
`mobile/README.md`, `ARCHITECTURE.md` §5) and `mobile/test/envelope_test.dart`
documents the intended normalization behavior — it has never been executed.
First action when an SDK is available:
`flutter pub get && flutter analyze && flutter test`.

Contract bridging that IS verified: the TypeScript mirror of the identical
normalization rules (`laravel/resources/js/lib/envelope.ts`) is covered by
the vitest suite (§3), and the wire format itself is exercised end-to-end
by the PHPUnit + smoke runs (§2, §4).

## 6. Security review notes

- No secrets committed: `laravel/.env.example` ships an EMPTY `APP_KEY`
  (operators run `php artisan key:generate`); the local `.env` is
  gitignored; `laravel/database/database.sqlite` (runtime data) is
  gitignored and not committed. Test fixtures use dictionary-type literals
  (`correcthorse1`, `wrongpassword1`, `@example.com` addresses) — chosen to
  stay clear of Gitleaks password-pattern rules.
- Envelope error responses never include stack traces/SQL (test-asserted);
  unexpected exceptions render as generic `INTERNAL_ERROR` after
  `report($e)`.
- Passwords: bcrypt (12 rounds via `BCRYPT_ROUNDS`), salted, never logged
  or returned; enumeration blocked (identical unknown-email/wrong-password
  bodies — test-asserted; dummy-hash timing burn for unknown emails).
- Session fixation: login rotates the session; logout invalidates
  server-side and revokes the old cookie over real HTTP (smoke-asserted).
- CSRF decision for `/api/v1` (SameSite=lax + no CSRF for native clients;
  web keeps CSRF): documented in ARCHITECTURE.md §3.1 with the wiring-bug
  history; wiring pinned by tests.
- Login throttle: 5 failed / 60 s per email+IP, 429 + `Retry-After`,
  success clears, correct password does not bypass (all test-asserted).
- `throttle:api` (240/min) is a coarse infra guard, documented as such.
- X-Request-Id validated against `^[A-Za-z0-9-]{1,64}$` (log-forging
  defense); invalid values replaced, header and body always agree.
- Workbench: fixed catalog only; no user-code execution path (source-scan
  test); input bounded at 10,000 chars with 400 `INPUT_TOO_LARGE`.

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Flutter pub get / analyze / test | **UNVERIFIED** | SDK not installed |
| Flutter runtime on device/emulator | **UNVERIFIED** | depends on above |
| PostgreSQL data path | **UNVERIFIED** | only sqlite exercised (no PG instance in this environment); code uses portable Eloquent/schema builder |
| `php artisan serve` | not run on this box | cannot bind ports here (opaque "reason: ?"); smoke used `php -S` with the same docroot/router instead |
| Redis (cache/queue) | not exercised | default database/array drivers used; `LOGIN_THROTTLE_STORE` documented for redis swap |
| Browser e2e (Playwright) | not implemented | out of task scope |
| Automated a11y audit | not implemented | out of task scope (labels/roles hand-checked) |
| Vite dev-server flow (`npm run dev` + HMR) | not run | production build + withoutVite() tests cover the shipped artifact path |

## 8. stack.json verification flags

- `manifest`: **true** — structure checked against
  `schemas/stack-manifest.schema.json` (id pattern, category, maturity
  enum, versions as version-strings, verification block); CI
  validate-catalog re-checks on the PR.
- `unit`: **true** — PHPUnit feature suite (envelope/auth/throttle/algorithm
  units) and the vitest envelope/page suites really ran green.
- `integration`: **true** — HTTP feature tests over the framework kernel
  (49 tests) plus the 53-check real-HTTP smoke run against a live PHP
  server.
- `e2e`: **false** — no automated browser/native e2e was run.
- `lastVerifiedAt`: 2026-10-25T00:00:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).
