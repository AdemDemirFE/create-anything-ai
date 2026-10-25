# Architecture — Stack 15 (Laravel 12 + Inertia 2 + Vue 3 + Flutter)

Reference implementation of catalog entry `15-laravel12-vue3-inertia-flutter`.
This document records the decisions a reader needs to understand the code;
verification evidence lives in `verification.md`.

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser (Vue 3 via Inertia)          Flutter mobile client         │
│   server-rendered page visits          JSON over /api/v1           │
│        (no client API layer)        (mobile/, NOT VERIFIED)       │
└──────────────┬──────────────────────────────┬──────────────────────┘
               │ same Laravel session         │ same Laravel session
               │  (stack15_session cookie)    │  (cookie replayed)
               ▼                              ▼
┌────────────────────────────────────────────────────────────────────┐
│ Laravel 12 (laravel/)                                              │
│  routes/web.php      Inertia pages (web group: sessions + CSRF)    │
│  routes/api.php      /api/v1 JSON (custom api group: NO CSRF,      │
│                      throttle:api, session cookie auth)            │
│  Envelope.php        { ok, data, error, requestId } builder        │
│  RequestId.php       X-Request-Id validation + echo (all routes)   │
│  LoginRateLimiter    FAILED-login throttle: 5 / 60 s / email+IP    │
│  AlgorithmEngine     fixed catalog, bounded input, hrtime measure  │
│  Eloquent ORM        users, notes, sessions, cache (sqlite/PG)     │
└────────────────────────────────────────────────────────────────────┘
```

## 1. The dual envelope (JSON API vs Inertia page props)

This stack intentionally speaks TWO response dialects and both are part of
the contract:

1. **`/api/v1` (JSON)** — the stack envelope, built by
   `app/Http/Responses/Envelope.php`:

   ```json
   { "ok": true,  "data": {...}, "error": null,
     "requestId": "validated-or-minted-id" }

   { "ok": false, "data": null,
     "error": { "code": "VALIDATION_ERROR", "message": "...",
                "details": [ { "field": "email", "code": "INVALID" } ] },
     "requestId": "..." }
   ```

   This is a documented variation of docs/PRODUCT_REQUIREMENTS.md §7 (which
   uses `success`/`meta.request_id`): `ok` instead of `success`, and the
   correlation id as a top-level `requestId` instead of `meta.request_id`.
   The shape is frozen by `tests/Feature/EnvelopeContractTest.php` and
   consumed by BOTH clients: the TS helper
   `laravel/resources/js/lib/envelope.ts` and its 1:1 Dart mirror
   `mobile/lib/api/envelope.dart`.

2. **Inertia pages (web)** — responses are real HTML round-trips; the
   "envelope" is Inertia's page props: shared props from
   `app/Http/Middleware/HandleInertiaRequests.php` (auth user, flash
   status/errors) plus per-page props. Validation errors flow through
   Laravel's standard redirected error bag, NOT through the JSON envelope.

Which dialect a controller method speaks is decided by `$request->is('api/*')`
(e.g. `NoteController@show`, `RegisteredUserController@store`). Exception
rendering follows the same split in `bootstrap/app.php`: everything mapped
to the envelope for `api/*`, plain HTTP semantics for web.

## 2. Auth: one session, two surfaces

- Single Laravel session (`stack15_session` cookie, HttpOnly, SameSite=lax,
  database driver). The Inertia pages and `/api/v1` share it.
- Login rotates the session id (fixation defense); logout invalidates the
  server-side session and rotates the token — a stolen pre-logout cookie is
  worthless afterwards (asserted over real HTTP by `scripts/smoke.mjs`).
- Passwords: bcrypt via Laravel's `Hash` facade, never logged or returned.
- Account enumeration: unknown email and wrong password produce the identical
  `INVALID_CREDENTIALS` envelope; a duplicate email on register is reported
  as a field error like any other invalid field (no "account exists"
  wording); a dummy hash verification burns time for unknown emails so
  response timing does not leak account existence.

## 3. Security decisions

### 3.1 `/api/v1` runs WITHOUT CSRF middleware (documented trade-off)

The custom `api` middleware group (bootstrap/app.php) = EncryptCookies +
cookies + StartSession + `throttle:api` + SubstituteBindings. It deliberately
excludes `ValidateCsrfToken`:

- Native mobile clients cannot perform the CSRF token dance (no browser cookie
  jar, no token endpoint contract in the four-screen spec).
- Cross-site browser abuse of `/api/v1` writes is mitigated by
  **SameSite=lax**: a cross-site POST from another origin does not carry the
  session cookie, so the forged request is unauthenticated.
- Additional mitigation: the failed-login rate limiter (below) bounds
  credential stuffing against the JSON surface.
- The web group (Inertia forms) KEEPS full CSRF protection — pinned by
  `ApiMiddlewareWiringTest::test_web_group_still_enforces_csrf_for_inertia_pages`.

**History (why this is test-pinned):** the first implementation mounted
`/api/v1` inside `routes/web.php` under the `web` group. PHPUnit did not
catch the resulting 419s because `ValidateCsrfToken::runningUnitTests()`
silently skips token verification under phpunit; the runtime smoke script
(`scripts/smoke.mjs` against a real `php -S` server) caught every write
failing with `CSRF_TOKEN_MISMATCH`. Routes now live in `routes/api.php`
(mounted via `withRouting(api:, apiPrefix: 'api/v1')`), and
`ApiMiddlewareWiringTest.php` fails if the routes drift back into the web
group or lose `throttle:api`. LESSON: PHPUnit-side CSRF bypass means
middleware wiring MUST be verified over real HTTP for any stack that skips
CSRF for API routes.

### 3.2 Rate limiting (two layers, different jobs)

| Layer | Where | Key | Budget | Response |
|---|---|---|---|---|
| `throttle:api` | whole `/api/v1` group | user id or IP | 240/min | 429 `RATE_LIMITED`, coarse abuse guard |
| `LoginRateLimiter` | login only | lowercased email + client IP | 5 FAILED attempts / 60 s (fixed window, array/database cache via `LOGIN_THROTTLE_STORE`) | 429 `RATE_LIMITED` + `Retry-After` |

Login limiter semantics (all test-asserted):

- Only FAILED attempts consume budget; success clears the tally.
- Throttle is checked BEFORE credentials: a correct password does NOT bypass
  an exhausted lockout (counter keyed on email+IP, not credential validity).
- `LoginThrottledException` carries `Retry-After`, rendered as a 429 envelope
  header + `RATE_LIMITED` code.

### 3.3 Request id correlation

`App\Http\Middleware\RequestId` (global, every response):

- A client-supplied `X-Request-Id` is accepted ONLY when it matches
  `^[A-Za-z0-9-]{1,64}$` (header-injection / log-forging defense). Anything
  else — too long, spaces, control characters — is discarded and a fresh
  opaque 32-hex id is minted.
- The validated/minted id is echoed as the `X-Request-Id` response header AND
  placed inside the envelope body (`requestId`), so header and body always
  carry the same correlation id (asserted by unit tests and the smoke script).

### 3.4 Algorithm workbench safety

- Fixed catalog only (`AlgorithmEngine::CATALOG`): reverse, word-count,
  fizzbuzz, palindrome. There is NO code-evaluation path (no eval/exec/
  process execution; source-scanned by test).
- Input is DATA, bounded at 10,000 chars (`ALGORITHM_MAX_INPUT`, tighten-only
  in deployments): oversized input → 400 `INPUT_TOO_LARGE`, never truncated.
- Measured duration (`hrtime`, monotonic) and the static Big-O note are
  separate result fields; measured time is never presented as complexity.

### 3.5 Never leaked to clients

Exception renderers map every failure to stable codes
(`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`RATE_LIMITED`, `INPUT_TOO_LARGE`, `UNKNOWN_ALGORITHM`,
`CSRF_TOKEN_MISMATCH`, `INTERNAL_ERROR`, `HTTP_<status>` fallback); the
`Throwable` renderer reports the real exception server-side (`report($e)`)
and returns the generic envelope. Stack traces/SQL/secrets never reach the
client (test-asserted).

## 4. Data model

Eloquent (the stack's ORM requirement): `users`, `notes`
(`user_id` FK, title ≤ 120, body ≤ 5000, indexed), Laravel's standard
`sessions` + `cache` tables. Ownership is enforced server-side on every
query (`$user->notes()` scope or explicit `authorizeOwner` check → 403
`FORBIDDEN` for foreign notes, never 404-masking). Local/tests run sqlite
(`DB_CONNECTION=sqlite`); production target is PostgreSQL 17 — no raw
sqlite-specific SQL exists in the app code.

## 5. Mobile client (mobile/ — NOT VERIFIED)

The Flutter client is written strictly against the frozen contract:

- `lib/api/envelope.dart` — 1:1 mirror of `laravel/resources/js/lib/envelope.ts`
  normalization (defensive UNKNOWN fallback for foreign bodies).
- `lib/api/api_client.dart` — captures the `stack15_session` cookie from
  `Set-Cookie`, persists it in `flutter_secure_storage` (never plain
  preferences), replays it on every request.
- Four-screen journey: Register → Login → Home (+ Notes CRUD) → Workbench.

The Flutter SDK was not available in the implementation environment: the
Dart code has NEVER been compiled, analyzed, or tested (see
`verification.md` §5). The envelope normalization rules it implements are
exercised for the identical TS mirror by vitest (`envelope.test.ts`).

## 6. Verification entry points

- `laravel/` — PHPUnit feature suite (49 tests), `php -l` clean.
- `laravel/scripts/smoke.mjs` — real-HTTP contract walk (53 checks):
  register/login/CRUD/403/throttle/429+Retry-After/request-id echo/logout
  revocation. Requires a running server; see `verification.md` §4.
- `laravel/resources/js/lib/envelope.test.ts` + Vue page tests — vitest.
- `verification.md` — what ran, what did not, exact commands.
