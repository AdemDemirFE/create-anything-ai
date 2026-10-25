# Verification — Stack 17 (TASK-017)

**Verified at (local):** 2026-10-25, 00:00–05:15 UTC+3 (approx.; single
session) + review follow-up round same day (§9)
**Branch:** `feat/stack-17-laravel12-react-inertia-reactnative` (merged as
PR #30) → review follow-up on `fix/stack-17-review-findings`
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
| Ziggy | v2.6.5 (`tightenco/ziggy`) | `composer.lock` |
| React | 19.3.1 / @inertiajs/react 2.3.29 | `package-lock.json` |
| TypeScript | 5.9.3 | `package-lock.json` |
| Vite | 8.3.5 / laravel-vite-plugin 3.2.0 | `package-lock.json` |
| Vitest | 5.0.5 | `package-lock.json` |
| PHPUnit | 11.5.57 | `composer.lock` |
| Expo SDK | ~52 declared in `mobile/package.json` | **SDK NOT INSTALLED** (`npx expo --version` never run — no `expo` package locally; see §5) |

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
to bind ports on this box in the stack-15 session; this session used PHP's
built-in server directly (§4).

## 2. Backend — PHPUnit (REAL, PASSED)

Command (exact):

```powershell
cd stacks/17-laravel12-react-inertia-reactnative/laravel
$env:PHPRC='C:\Users\ademir\AppData\Local\Temp\opencode\stack15-php.ini'
composer install                 # exit 0 (session start); ziggy added mid-session, exit 0
php vendor\phpunit\phpunit\phpunit
```

Result: **OK (54 tests, 269 assertions)**, exit 0.

```text
OK (54 tests, 269 assertions)
```

Coverage by file (inherited from the proven stack-15 backend, adapted to
stack 17; the suite covers the backend contract, not the page dialect):

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
  **404 `NOT_FOUND` for foreign notes — identical to a missing id**
  (no-enumeration, review follow-up §9; originally 403 `FORBIDDEN`),
  validation bounds (title 120, body 5000 → 422), Inertia page variants
  render, bounded list contract (default 50 / max 100 / page / total /
  hasMore metadata + clamp/fallback rules, §9).
- `AlgorithmApiTest` — fixed catalog, run output + measured `execution_ms`
  separate from static `complexity`, unknown id 400 `UNKNOWN_ALGORITHM`,
  oversized input 400 `INPUT_TOO_LARGE` (at-cap accepted), input never
  executed.
- `ScreenContractTest` — Inertia page props for all four screens (Welcome,
  Dashboard, Notes index/show/form, Algorithm workbench).
- `ApiMiddlewareWiringTest` — regression guard for the CSRF-419 lesson
  (inherited from stack 15): `/api/v1` routes are in the `api` group only
  (no `ValidateCsrfToken`, with `throttle:api` present), web routes keep
  CSRF. Review follow-up: the unauthenticated auth endpoints
  (`api.register`, `api.login`) additionally carry `throttle:auth-ip`
  (§9) and authenticated data routes do NOT.

> Counts above reflect the original PR #30 round (54 tests). The
> review-follow-up round grew the suite to **61 tests / 330 assertions**
> (all green) — see §9 for the delta.

## 3. Shared layer + web build + vitest (REAL, PASSED)

The transport-agnostic TypeScript shared layer
(`stacks/17-laravel12-react-inertia-reactnative/shared/src/`) is the JSON
contract surface for direct fetches and the React Native thin shell. It is
a standalone package with its own vitest suite, independent of the Laravel
app.

Commands (exact):

```powershell
cd stacks/17-laravel12-react-inertia-reactnative/shared
npm.cmd install                  # exit 0
npm.cmd test                     # vitest run

cd ..\laravel
npm.cmd install                  # exit 0 (215 packages, clean after one ENOSPC-interrupted attempt was wiped)
npm.cmd run typecheck            # tsc --noEmit
npm.cmd test                     # vitest run (page tests, jsdom)
npm.cmd run build                # vite build
```

Results:

```text
shared  npm.cmd test      → Test Files 1 passed (1), Tests 15 passed (15), EXIT 0
laravel npm.cmd typecheck → tsc --noEmit, no output, EXIT 0
laravel npm.cmd test      → Test Files 1 passed (1), Tests 9 passed (9), EXIT 0
laravel npm.cmd run build → ✓ built in ~1.3s, public/build/ emitted, EXIT 0
```

Coverage:

- `shared/src/api-client.test.ts` (15 tests) — envelope parsing
  (success/failure/foreign bodies), `ApiError` codes, bounded payloads,
  notes CRUD + algorithm + auth methods against a stubbed `fetch`, header
  propagation (`X-Request-Id`), synthetic requestId fallback.
- `laravel/resources/js/pages/pages.test.tsx` (9 tests) — React page
  behavior with mocked `@inertiajs/react`: Welcome auth-state rendering,
  Login submit + error-bag rendering (banner vs inline credential error),
  Register submit, Dashboard props rendering, Notes index/delete wiring,
  Algorithm catalog + run submit. Tests back the `useForm` mock with real
  React state so HTML5 constraint validation (`required` fields) behaves
  like the browser.
- `tsc --noEmit` covers all of `resources/js/**` + `vite.config.ts` with
  `strict: true` (strict null checks, no unused locals not enabled —
  `strict` only).

Note: `public/build/` is a deploy artifact and gitignored; feature tests
call `withoutVite()` globally (`tests/TestCase.php`) so they never depend
on it. The production build excludes test files from the page glob
(`import.meta.glob(['./pages/**/*.tsx', '!./pages/**/*.test.tsx'])`) —
the first build swept `pages.test.tsx` into a 508 kB chunk, fixed before
commit.

## 4. Runtime smoke over real HTTP (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/17-laravel12-react-inertia-reactnative/laravel
$env:PHPRC='C:\Users\ademir\AppData\Local\Temp\opencode\stack15-php.ini'
php artisan migrate:fresh --force
cd public
php -S 127.0.0.1:8017 index.php          # background
cd ..
node scripts\smoke.mjs                   # SMOKE_BASE_URL=http://127.0.0.1:8017
node scripts\smoke-web.mjs               # SMOKE_BASE_URL=http://127.0.0.1:8017
```

(`php artisan serve` was not retried this session; stack-15 recorded that
it cannot bind ports on this box. PHP's built-in server with Laravel's
`public/index.php` router serves the identical application. On a normal
machine `php artisan serve --port=8000` + `SMOKE_BASE_URL=http://127.0.0.1:8000`
is equivalent.)

Results:

```text
smoke.mjs      → smoke checks: 53/53 passed, SMOKE PASSED, exit 0
smoke-web.mjs  → web-flow checks: 16/16 passed, WEB SMOKE PASSED, exit 0
```

What the 53 API checks cover (in order; same contract as stack 15,
`stack17_session` cookie name):

- `/api/v1/health` 200 with strict envelope shape.
- X-Request-Id: valid id echoed in header AND envelope body; oversized
  (80-char) id discarded and replaced by an opaque 32-hex id in both.
- Register 201 (+ user payload); duplicate register 422 with
  `error.details[].field = "email"` and no account-existence wording;
  invalid fields 422 `VALIDATION_ERROR`.
- Unauthenticated `/notes` 401 `UNAUTHENTICATED`.
- Wrong password 401 generic `INVALID_CREDENTIALS` (message is the
  enumeration-safe generic).
- Login 200 + `stack17_session` cookie captured.
- Notes: create 201, list contains it, update persists, show returns
  updated body.
- Foreign note read (second registered user) → **404 `NOT_FOUND`**
  (review follow-up §9; originally 403 `FORBIDDEN`), foreign ≡ missing
  envelope, foreign write also 404.
- Workbench: catalog + `maxInputLength = 10000`; reverse run output
  `dlrow olleh` with numeric `execution_ms` and `complexity: "O(n)"`;
  unknown algorithm 400 `UNKNOWN_ALGORITHM`; oversized input 400
  `INPUT_TOO_LARGE`.
- Throttle: 5 failed logins → 6th returns 429 `RATE_LIMITED` with
  `Retry-After > 0`; a different account's login is unaffected (per-email
  keying).
- Logout 200 (`logged_out: true`); post-logout `/notes` with the same
  cookie → 401 (server-side revocation).

What the 16 web-flow checks cover (new in stack 17; the web Inertia surface
was only partially exercised in stack 15):

- `GET /` renders the full Inertia shell: 200, `csrf-token` meta,
  `data-page` JSON script tag with `component: "Welcome"` and shared
  `auth` prop.
- Ziggy `@routes` injects the `route()` helper (the `const Ziggy={...}`
  route map is present in the HTML) — pages call `route()` everywhere, so
  without this injection every page would crash at runtime. Ziggy was
  added to composer.json during this session for exactly this reason;
  the pages.test.tsx suite stubs `route()`, so this wiring would
  otherwise have shipped untested.
- Web register POST (CSRF token + session cookie, form-encoded, **no
  `X-Inertia` header** — see §4b) redirects 302.
- Web login POST redirects 302 to `/dashboard`.
- `GET /dashboard` with the session renders `component: "Dashboard"` with
  the logged-in user in `props.auth`.
- `GET /notes/create` renders `Notes/Form` with a CSRF token; web note
  POST redirects; `GET /notes` list props contain the created note.
- Web logout POST redirects; `GET /dashboard` afterwards redirects 302 to
  `/login` (session revoked server-side).

## 4b. Issues found and fixed during the smoke runs (all resolved)

1. **Blade entry still referenced `resources/js/app.js`** (the Vue entry
   inherited from stack 15) → Vite manifest lookup failed → **500 on every
   web page** over real HTTP. Fixed: `app.blade.php` now references
   `resources/js/app.tsx`; the stale scaffold `welcome.blade.php` was
   deleted (`/` renders the Inertia `Welcome` page).
2. **`route()` helper was never provided at runtime.** Pages call
   `route()` in 25 places; the scaffold had no Ziggy and no global
   injection, so the first real-browser page load would have thrown
   `ReferenceError: route is not defined`. Fixed: `tightenco/ziggy`
   added to composer.json and `@routes` directive added to
   `app.blade.php`; the web-flow smoke now asserts the `Ziggy` route map
   is present in served HTML (§4).
3. **Smoke-script protocol bug (harness, not app):** the first web-smoke
   draft sent `X-Inertia: true` on every request. Laravel then returned
   raw JSON instead of HTML (or 409 on version mismatch), which broke the
   CSRF-extraction parsing. Rewritten to send plain browser-like requests
   (full HTML + 302 redirect following, no `X-Inertia` header).

## 5. Mobile — React Native (NOT RUN — SDK missing)

**UNVERIFIED — `npm install` inside `mobile/`, `npx expo start`, Expo Go,
Android/iOS builds COULD NOT BE EXECUTED because the Expo/React Native
toolchain is not installed in this environment (and `npm install` for the
RN dependency tree was not run — the deliverable is a thin shell whose
dependencies are declared but never fetched).** No build, render, or test
claim is made for `mobile/`. The shell (App.tsx, index.ts, app.json) is
written strictly against the frozen envelope contract via the shared layer
(see `mobile/README.md`, ARCHITECTURE.md §5) — it imports
`../shared/src/api-client` and would speak the verified wire format.
First action when a toolchain is available:
`cd mobile && npm install && npx expo start` (or `npx expo prebuild`).

Contract bridging that IS verified: the shared layer's envelope
normalization + API client (`shared/src/api-client.ts`, the exact module
the RN shell imports) is covered by the 15-test vitest suite (§3), and the
wire format itself is exercised end-to-end by the PHPUnit + smoke runs
(§2, §4).

## 6. Security review notes

- No secrets committed: `laravel/.env.example` ships an EMPTY `APP_KEY`
  (operators run `php artisan key:generate`); the local `.env` is
  gitignored (checked with `git check-ignore`); the generated key never
  enters git. `laravel/database/database.sqlite` (runtime data) is
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
  server-side and revokes the old cookie over real HTTP (both smokes
  assert revocation).
- CSRF decision for `/api/v1` (SameSite=lax + no CSRF for native clients;
  web keeps CSRF): documented in ARCHITECTURE.md §3.1 with the CSRF-419
  wiring-bug history inherited from stack 15; wiring pinned by
  `ApiMiddlewareWiringTest`. Unlike stack 15, the fix was inherited
  pre-emptively (routes/api.php separate group from day one); no 419
  occurred this session — the first smoke run passed 53/53 on the first
  try.
- Login throttle: 5 failed / 60 s per email+IP, 429 + `Retry-After`,
  success clears, correct password does not bypass (all test-asserted).
- Per-IP auth throttle (review follow-up, §9): `throttle:auth-ip` bounds
  register/login to 30 POSTs/min/IP (env-tunable) IN ADDITION to the
  email+IP failed-login limiter — closes the credential-stuffing hole
  where one IP rotates unlimited emails at 5 failures each.
- `throttle:api` (240/min) is a coarse infra guard, documented as such.
- X-Request-Id validated against `^[A-Za-z0-9-]{1,64}$` (log-forging
  defense); invalid values replaced, header and body always agree.
- Workbench: fixed catalog only; no user-code execution path (source-scan
  test); input bounded at 10,000 chars with 400 `INPUT_TOO_LARGE`.

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| RN `npm install` / `npx expo start` / Expo Go | **UNVERIFIED** | Expo/RN toolchain not installed; `mobile/` deps declared but never fetched |
| RN runtime on device/emulator | **UNVERIFIED** | depends on above |
| Shared layer in a real RN runtime (fetch polyfill, CORS) | **UNVERIFIED** | vitest stubs `fetch`; real RN `fetch` behavior not exercised |
| PostgreSQL data path | **UNVERIFIED** | only sqlite exercised (no PG instance in this environment); code uses portable Eloquent/schema builder |
| `php artisan serve` | not run on this box | stack-15 record: cannot bind ports here (opaque "reason: ?"); smoke used `php -S` with the same docroot/router instead |
| Redis (cache/queue) | not exercised | default database/array drivers used; `LOGIN_THROTTLE_STORE` documented for redis swap |
| Browser e2e (Playwright) | not implemented | out of task scope; web flow covered by HTTP-level smoke (§4) |
| Automated a11y audit | not implemented | out of task scope (labels/roles hand-checked) |
| Vite dev-server flow (`npm run dev` + HMR) | not run | production build + withoutVite() tests cover the shipped artifact path |
| Full React render of served pages in a real browser | not run | jsdom page tests + HTTP-level web-flow smoke cover component behavior and server contract; headless-browser render out of scope |

## 8. stack.json verification flags

- `manifest`: **true** — structure checked against
  `schemas/stack-manifest.schema.json` (required fields, id pattern
  `^[0-9]{2}-...`, category, maturity enum, versions as version-strings,
  verification block; property-name cross-check run in this session). CI
  validate-catalog re-checks on the PR.
- `unit`: **true** — PHPUnit feature suite (61 tests after the review
  follow-up) + shared-layer vitest (17 tests) + page vitest (9 tests)
  really ran green.
- `integration`: **true** — HTTP feature tests over the framework kernel
  plus the 61-check API smoke and 16-check web-flow smoke against a live
  PHP server.
- `e2e`: **false** — no automated browser/native e2e was run.
- `lastVerifiedAt`: 2026-10-25T00:00:00Z (UTC date of the green runs).
- `evidencePath`: `verification.md` (this file).

## 9. Review follow-up round (REAL, PASSED)

Orchestrator review findings on the merged PR #30, applied on a fresh
`fix/stack-17-review-findings` branch from post-merge `origin/main`
(`7d21b68`). Same re-land pattern as stack 16's follow-up.

### 9.1 Note ownership 403 → 404 (no-enumeration)

The old `NoteController::authorizeOwner` aborted **403 FORBIDDEN** for a
foreign note id. That status tells a probing client the id EXISTS (but
belongs to someone else) — an existence oracle over sequential ids. Fix:
owner check now aborts **404**, the exact response a MISSING id produces
(same `NOT_FOUND` envelope code on `/api/v1`, standard 404 page on the web
surface). Foreign and missing ids are now indistinguishable for read AND
write (GET/PUT/DELETE).

- Test: `NoteCrudTest::test_another_users_note_is_not_found_like_a_missing_one`
  — asserts 404 + `NOT_FOUND` for foreign read/update/delete, the note is
  untouched, and (via the smoke) foreign and missing envelopes are
  byte-identical.
- `smoke.mjs` foreign-note block rewritten: 403/FORBIDDEN checks →
  404/NOT_FOUND + foreign≈missing identity + foreign PUT 404.

### 9.2 Notes list pagination (default + max)

The `/api/v1/notes` list (and the Inertia web index) returned an
UNBOUNDED `->get()` — one user with a million notes would serialize the
whole table per request. Fix:

- `limit` query param: default **50**, hard max **100** (larger values
  clamp — tighten-only), invalid (0/negative/non-numeric) falls back to
  the default; `page` (>= 1, clamped to 1).
- Envelope data now carries pagination metadata:
  `{ notes, page, limit, total, hasMore }` (`total` = the authenticated
  user's note count; `hasMore = page*limit < total`).
- Ordering made deterministic: `created_at DESC, id DESC` (id breaks
  same-second ties) on API list, web index, and dashboard recent-notes.
- The web `Notes/Index.tsx` page accepts the `page`/`limit` props and
  shows an "Older notes →" link when the page is exactly full.
- Shared client (`shared/src/api-client.ts`): `listNotes({ page?, limit? })`
  builds the query and refuses invalid/oversized params CLIENT-side
  (`VALIDATION_ERROR` / `INPUT_TOO_LARGE` before any network call);
  new `NotesPageData` type + `NOTES_MAX_LIMIT = 100`. The bare
  `listNotes()` call the RN shell makes is unchanged (server default
  applies) — mobile stays source-compatible.
- Bounds single-sourced in `config/stack.php`
  (`notes_list_default_limit` / `notes_list_max_limit`, env-tunable).
- Tests (new, `NoteCrudTest`): bounded list with page/limit/total/hasMore
  over 3 pages (no overlap, full coverage), clamp/fallback rules, and the
  bounded web index (`?limit=2&page=1` reflected in Inertia props).

### 9.3 Per-IP throttle on register/login (OPTIONAL — implemented)

The failed-login limiter keys on email+IP: one IP could rotate unlimited
emails at 5 failures each (credential stuffing) and mass-create accounts.
Fix (in addition to, not replacing, that limiter):

- `RateLimiter::for('auth-ip')` in `AppServiceProvider` —
  `Limit::perMinute(30)->by($request->ip())`, budget from
  `config('stack.auth_ip_throttle_limit')` (env `AUTH_IP_THROTTLE_LIMIT`;
  window fixed at 60 s by `perMinute`).
- Applied as `throttle:auth-ip` on the unauthenticated `POST /register`
  + `POST /login` API routes ONLY (verified: authenticated data routes do
  NOT carry it — `ApiMiddlewareWiringTest`). Exhaustion → 429 +
  `Retry-After` + `RATE_LIMITED` envelope via the existing
  ThrottleRequestsException renderer.
- Tests (`ApiThrottleContractTest`): exhausting the per-IP bucket
  (`md5('auth-ip127.0.0.1')`, the real
  `ThrottleRequests::handleRequestUsingNamedLimiter` key derivation)
  429s the next register POST with a valid payload — nothing persisted;
  clearing the bucket (window expiry) restores 201.
- The 30/min budget leaves headroom for the real-HTTP smoke (~14 auth
  POSTs per run) while capping scripted floods; demo-grade by design
  (edge/production enforcement documented in ARCHITECTURE.md).

### 9.4 Commands and results (this round, all REAL)

```powershell
# PHPUnit (PHPRC ini for sqlite drivers, as in §2)
php vendor\phpunit\phpunit\phpunit
#   → OK (61 tests, 330 assertions), exit 0

cd ..\shared ; npm.cmd test          # → 17 passed (17), exit 0
                                     #   (15 + 2 new pagination tests)
npx.cmd tsc --noEmit                 # → clean, exit 0

cd ..\laravel
npm.cmd run test                     # page vitest → 9 passed (9), exit 0
npm.cmd run build                    # → ✓ built in 2.29s, exit 0

php artisan migrate:fresh --force
php -S 127.0.0.1:8017 index.php      # from public/, background
node scripts\smoke.mjs               # → smoke checks: 61/61 passed, exit 0
node scripts\smoke-web.mjs           # → web-flow checks: 16/16 passed, exit 0
```

Delta vs the merged PR #30 round: PHPUnit 54→61 tests (269→330
assertions), shared vitest 15→17, API smoke 53→61 checks (new: pagination
metadata, limit=1 + hasMore, page=2 slice, clamp-to-100, foreign-note
404/NOT_FOUND, foreign≈missing identity, foreign PUT 404). Web smoke
16/16 unchanged. `php -l` sweep clean on every touched PHP file.

### 9.5 UNVERIFIED (unchanged from §7)

All §7 rows stand: RN runtime, PostgreSQL/Redis paths, `php artisan
serve`, browser e2e. No new unverified areas introduced by this round.
