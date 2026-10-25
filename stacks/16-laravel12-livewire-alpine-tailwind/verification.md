# Verification — Stack 16 (TASK-016)

**Verified at (local):** 2026-10-25 (single session)
**Branch:** `feat/stack-16-laravel12-livewire-alpine-tailwind`
**Scope rule:** every claim below is tied to a command that actually ran in
this session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| PHP | 8.3.33 (CLI) | `php -v` |
| Composer | 2.10.3 | `composer --version` |
| Node.js | v24.19.0 | `node --version` |
| Laravel | 12.70.1 (`laravel/framework`) | `composer.lock` |
| Livewire | livewire/livewire v3.8.11 | `composer.lock` |
| Alpine.js | alpinejs 3.17.5 | `package-lock.json` |
| Tailwind CSS | **3.4.19** (v3, NOT v4) | `package-lock.json` |
| Vite | 8.3.5 / laravel-vite-plugin 3.2.0 | `package-lock.json` |
| PHPUnit | 11.5.57 | `composer.lock` |

**Environment workaround (this machine):** the system `php.ini`
(`C:\tools\php83\php.ini`) ships without `pdo_sqlite`/`sqlite3`. All PHP
commands in this session ran with
`PHPRC=C:\Users\ademir\AppData\Local\Temp\opencode\stack16-php.ini`, a
session-scoped ini that mirrors the system config plus the SQLite drivers.
It is NOT installed system-wide and NOT part of the repo. On a normal
Laravel dev machine (pdo_sqlite enabled) no workaround is needed.
Consequence: `php artisan test` FAILS in this environment (the Collision
subprocess drops `PHPRC` → "could not find driver"); the documented run
command is the direct PHPUnit binary below. The smoke server also used
PHP's built-in server directly (`php -S`) rather than `php artisan serve`
(§4), matching the stack 15 precedent on this box.

## 2. Backend — PHPUnit (REAL, PASSED)

Command (exact):

```powershell
cd stacks/16-laravel12-livewire-alpine-tailwind/laravel
$env:PHPRC='C:\Users\ademir\AppData\Local\Temp\opencode\stack16-php.ini'
composer install                 # exit 0 (livewire/livewire v3.8.11 resolved)
php vendor\phpunit\phpunit\phpunit
```

Result: **OK (67 tests, 305 assertions)**, exit 0. (Initial run before the
review follow-up: 63 tests / 290 assertions; the 4 new contract tests and
assertions were added in the review round — see §2c.)

```text
OK (67 tests, 305 assertions)
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
  5000 → 422), the JSON + Livewire dual-surface split.
- `AlgorithmApiTest` — fixed catalog, run output + measured `execution_ms`
  separate from static `complexity`, unknown id 400 `UNKNOWN_ALGORITHM`,
  oversized input 400 `INPUT_TOO_LARGE` (at-cap accepted), input never
  executed; **engine-bound contract (review follow-up):**
  `config('stack.algorithm_max_input')` is enforced by the engine as the
  single source of truth — a tightened bound (e.g. 250) shows up in the
  catalog `maxInputLength` AND makes `run()` reject input above it; invalid
  / loosening config values clamp back to the default (tighten-only);
  reverse is code-point (multibyte) safe.
- `ApiThrottleContractTest` — trips `throttle:api`, asserts 429
  `RATE_LIMITED` (ThrottleRequestsException renderer precedence).
- `ApiMiddlewareWiringTest` — regression guard for the CSRF-419 lesson
  (§2b): `/api/v1` routes are in the `api` group only (no
  `ValidateCsrfToken`, with `throttle:api` present); `/livewire/update` is
  pinned INSIDE the web group (Livewire's CSRF-protected update endpoint
  must never be moved to the api group); web routes keep CSRF.
- `tests/Feature/Livewire/` — Livewire 3 component tests via
  `Livewire::test()`:
  - `NotesIndexTest` — full-page component: `wire:model.live` search
    filter, per-user scoping, authorization on click-through actions;
    search terms with LIKE wildcards (`50% off`) match literally
    (wildcards escaped, `ESCAPE` char passed as a binding — review
    follow-up).
  - `NoteFormTest` — create + edit modes, validation, ownership
    re-scoping on every action via the `AuthorizesNote` trait;
    `#[Locked] noteId` rejects client-side `set()` with
    `CannotUpdateLockedPropertyException` (ownership cannot be hijacked
    from the browser).
  - `WorkbenchTest` — `#[Locked] algorithmId` (set() throws),
    catalog rendering, run action output + measured `execution_ms`
    separate from static complexity, oversize input rejected.
  - `LivewirePageTest` — `/notes` and `/algorithm` mount as full-page
    Livewire components (wire:snapshot present).

## 2b. Runtime smoke found a real Blade component wiring gap (FIXED, re-verified)

The first smoke run (§4) returned **HTTP 500** for every classic Blade page
(welcome, login, dashboard): Laravel 12 core ships **no default
auto-resolution for `<x-*>` anonymous components** — starter kits (Breeze
et al.) register `Blade::anonymousComponentNamespace('components')`
themselves, and stack 15 never used `x-*` tags, so the gap was invisible
until now. Livewire pages were unaffected (they use explicit
`->layout('components.app-layout')`).

Fix (all in-repo, suite + smoke re-run green afterwards):

1. Layout moved to
   `resources/views/components/app-layout.blade.php` (so the tag name maps
   1:1 under the `components` namespace).
2. `AppServiceProvider::boot()` registers
   `Blade::anonymousComponentNamespace('components')` — the ecosystem
   standard.
3. The four Livewire full-page components now point at
   `->layout('components.app-layout')`.
4. A comment in `AppServiceProvider` documents why the registration is
   required (future stacks copying this skeleton will not re-trip it).

Also fixed during the same smoke loop: the `livewire/update` 419 body
leaked a stack trace because the local server `.env` had `APP_DEBUG=true`
(smoke check "livewire/update 419 does not leak internals" failed). With
`APP_DEBUG=false` (as any deployed environment would have) the 419 renders
the safe generic body. Committed artifacts are unaffected: `.env.example`
ships `APP_DEBUG=true` for local dev, and no committed file depends on a
debug-enabled server.

## 2c. Review follow-up round (REAL, PASSED)

Orchestrator review findings on PR #31, all fixed and re-verified:

1. **`ALGORITHM_MAX_INPUT` advertised but not enforced by the engine
   (REQUIRED — fixed).** The engine hardcoded `MAX_INPUT_LENGTH = 10_000`
   while `config('stack.algorithm_max_input')` was only rendered by the
   catalog and the Livewire workbench — tightening the env var changed
   nothing server-side. Fix: the engine now resolves the config in its
   constructor (tighten-only clamp: lower allowed, never above the new
   `ABSOLUTE_MAX_INPUT_LENGTH = 100_000` ceiling; invalid/zero/negative
   values fall back to the default) and `run()` enforces the resolved
   value. Both consumers — `AlgorithmController::maxInputLength()` (the
   `/api/v1` catalog field) and the Livewire workbench
   `getMaxInputLengthProperty()` — now render `engine->maxInputLength()`
   instead of reading config themselves. Contract tests:
   `test_catalog_and_engine_agree_with_configured_bound` (config 250 →
   catalog shows 250, at-cap 200 OK, 251 → 400 `INPUT_TOO_LARGE` with the
   configured number in the message) and
   `test_engine_clamps_invalid_config_values_tighten_only`.
2. **LIKE wildcard escaping (OPTIONAL — implemented).** The notes search
   interpolated the raw term between `%...%`, so a search for `50% off`
   matched every row containing `50<anything>` (`%`/`_` kept their wildcard
   meaning). Fix: the user term is passed through
   `addcslashes(mb_strtolower($term), '\\%_')` and the WHERE clause now
   declares the escape character as a BINDING
   (`title LIKE ? ESCAPE ?` / `orWhereRaw(... ESCAPE ?)` with `\` bound) —
   portable across sqlite and PostgreSQL (neither enables a default escape
   character), no PHP-side SQL-quote juggling. Test:
   `test_search_treats_like_wildcards_as_literals`.
3. **Multibyte `reverse` (OPTIONAL — implemented).** `strrev()` is
   byte-wise and shredded multi-byte UTF-8 (probe: `strrev('ünïcødé')`
   produces an invalid byte sequence). Fix: reverse by code point via
   `preg_split('//u')` + `array_reverse` (probe confirmed `mb_strrev` is
   NOT available in this mbstring build); the palindrome check uses the
   same mb-safe reverse. Tests: `test_reverse_is_multibyte_safe` (asserts
   `édøcïnü` round-trips intact).

Full suite after the round: **OK (67 tests, 305 assertions)**; smoke
re-run **67/67 checks passed**; `php -l` sweep clean.

## 3. Web build (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/16-laravel12-livewire-alpine-tailwind/laravel
npm.cmd ci                      # exit 0
npm.cmd run build               # vite build (tailwindcss v3 via PostCSS)
```

Results:

```text
npm.cmd ci      → exit 0 (alpinejs 3.17.5, tailwindcss 3.4.19, vite 8.3.5)
npm.cmd run build → public/build/ emitted: CSS ~9.72 kB, JS (Alpine) ~55.72 kB
```

Note: `public/build/` is a deploy artifact and gitignored; feature tests
call `withoutVite()` globally (`tests/TestCase.php`) so they never depend
on it. There is no JS unit-test runner in this stack (no SPA framework, no
client-side data layer to test — Livewire round-trips the state server-side
and is covered by the Livewire::test suite).

## 4. Runtime smoke over real HTTP (REAL, PASSED)

Command (exact):

```powershell
cd stacks/16-laravel12-livewire-alpine-tailwind/laravel
$env:PHPRC='C:\Users\ademir\AppData\Local\Temp\opencode\stack16-php.ini'
php artisan migrate:fresh --force
cd public
php -S 127.0.0.1:8096 index.php          # background
cd ..
node scripts\smoke.mjs                   # SMOKE_BASE_URL=http://127.0.0.1:8096
```

(As on the stack 15 box, `php artisan serve` was bypassed in favour of
PHP's built-in server with Laravel's `public/index.php` router — the
identical application. On a normal machine `php artisan serve --port=8000`
+ `SMOKE_BASE_URL=http://127.0.0.1:8000` is equivalent.)

Result: **67/67 checks passed, SMOKE PASSED, exit 0.**

What the 67 checks cover (in order):

- `/api/v1/health` 200 with strict envelope shape, payload names
  `stack-16`.
- X-Request-Id: valid id echoed in header AND envelope body; oversized
  (80-char) id discarded and replaced by an opaque 32-hex id in both;
  minted id lands in the body too.
- Register 201 (+ user payload); duplicate register 422 with
  `error.details[].field = "email"` and no account-existence wording;
  invalid fields 422 `VALIDATION_ERROR`.
- Unauthenticated `/notes` 401 `UNAUTHENTICATED`.
- Wrong password 401 generic `INVALID_CREDENTIALS` (message is the
  enumeration-safe generic).
- Login 200 + `stack16_session` cookie captured.
- Notes: create 201, list contains it, update persists, show returns
  updated body.
- Foreign note read (second registered user) → 403 `FORBIDDEN`.
- Workbench: catalog + `maxInputLength = 10000`; reverse run output
  verified; numeric `execution_ms` + static `complexity` in the result;
  unknown algorithm 400 `UNKNOWN_ALGORITHM`; oversized input 400
  `INPUT_TOO_LARGE`.
- Web surface over real HTTP: welcome page renders 200 HTML with Livewire
  boot markers; login page renders with a CSRF token; dashboard renders
  200 for the session and shows the profile email.
- Livewire full-page components: `/notes` renders 200, carries
  `wire:snapshot`, shows the smoke-created note title; `/algorithm`
  renders 200 with `wire:snapshot` and the fixed catalog.
- CSRF wiring over real HTTP: tokenless POST to `livewire/update` → 419
  (web-grouped, CSRF enforced; NOT 404/405), and the 419 body leaks no
  internals.
- Throttle: 5 failed logins → 6th returns 429 `RATE_LIMITED` with
  `Retry-After > 0`; a different account's login is unaffected (per-email
  keying).
- Logout 200 (`logged_out`); post-logout `/notes` with the same cookie →
  401 (server-side revocation).

Issues found and fixed during the smoke run (all resolved, re-run green):

1. `<x-app-layout>` 500 on classic Blade pages — anonymous component
   namespace registration was missing; full story in §2b.
2. 419 debug-leak — local `.env` had `APP_DEBUG=true`; smoke correctly
   flagged the trace leak. Local-only artifact, not committed.

## 5. `php -l` syntax sweep (REAL, PASSED)

```powershell
Get-ChildItem -Recurse -Include *.php -Path app,routes,config,tests,database,bootstrap |
  ForEach-Object { php -l $_.FullName }
```

Result: **0 failures** across `app/`, `routes/`, `config/`, `tests/`,
`database/`, `bootstrap/`.

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
  web AND `/livewire/update` keep CSRF): documented in ARCHITECTURE.md with
  the stack-15 wiring-bug history; wiring pinned by
  `ApiMiddlewareWiringTest` and exercised over real HTTP by the smoke run
  (tokenless `livewire/update` POST → 419).
- Login throttle: 5 failed / 60 s per email+IP, 429 + `Retry-After`,
  success clears, correct password does not bypass (all test-asserted).
- `throttle:api` (240/min) is a coarse infra guard, documented as such.
- X-Request-Id validated against `^[A-Za-z0-9-]{1,64}$` (log-forging
  defense); invalid values replaced, header and body always agree.
- Workbench: fixed catalog only; no user-code execution path (source-scan
  test); input bounded at 10,000 chars with 400 `INPUT_TOO_LARGE`;
  `algorithmId` is `#[Locked]` in the Livewire component so the browser
  cannot swap in an arbitrary id.
- Livewire-specific hardening: `noteId` on the form component is
  `#[Locked]` and ownership is re-authorized on every action
  (`AuthorizesNote`) — mass-assignment/ownership hijack via
  `wire:model`/`set()` is rejected server-side (test-asserted).

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| PostgreSQL data path | **UNVERIFIED** | only sqlite exercised (no PG instance in this environment); code uses portable Eloquent/schema builder |
| `php artisan serve` | not run on this box | cannot bind ports here (stack-15 precedent); smoke used `php -S` with the same docroot/router instead |
| Redis (cache/queue) | not exercised | default database/array drivers used; `LOGIN_THROTTLE_STORE` documented for redis swap |
| Browser e2e (Playwright) | not implemented | out of task scope |
| Automated a11y audit | not implemented | out of task scope (labels/roles hand-checked) |
| Vite dev-server flow (`npm run dev` + HMR) | not run | production build + withoutVite() tests cover the shipped artifact path |
| PWA manifest (catalog note) | not implemented | catalog row mentions PWA; the four-screen task scope did not include an installable manifest — see stack.json `description` |
| Livewire `wire:navigate` SPA-mode navigation | not enabled | full-page components + classic redirects only; out of the four-screen scope |
| Pint / CS fixer | not run | only `php -l` sweep + phpunit (matches stack 15 verification depth) |

## 8. stack.json verification flags

- `manifest`: **true** — structure checked against stack 15's accepted
  manifest shape (id pattern, category, maturity enum, versions as
  version-strings, verification block); CI validate-catalog re-checks on
  the PR.
- `unit`: **true** — PHPUnit feature suite (envelope/auth/throttle/
  algorithm units + 17 Livewire component tests) really ran green.
- `integration`: **true** — HTTP feature tests over the framework kernel
  (67 tests) plus the 67-check real-HTTP smoke run against a live PHP
  server.
- `e2e`: **false** — no automated browser e2e was run.
- `lastVerifiedAt`: 2026-10-25T00:00:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).
