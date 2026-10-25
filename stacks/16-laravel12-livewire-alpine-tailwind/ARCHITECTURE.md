# Architecture — Stack 16 (Laravel 12 + Livewire 3 + Alpine 3 + Tailwind 3)

Reference implementation of catalog entry `16-laravel12-livewire-alpine-tailwind`.
This document records the decisions a reader needs to understand the code;
verification evidence lives in `verification.md`. Stack 15
(`15-laravel12-vue3-inertia-flutter`) is the sibling reference on the same
backend; §7 contrasts the two front-end approaches.

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser (Blade + Livewire 3 + Alpine 3)                            │
│   full-page components + wire: actions over /livewire/update       │
│   Alpine for pure-UI flourishes (dismiss flash, toggle visibility) │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ same Laravel session
                               │  (stack16_session cookie)
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Laravel 12 (laravel/)                                              │
│  routes/web.php      Blade pages + full-page Livewire components    │
│                      (web group: sessions + CSRF)                   │
│  routes/api.php      /api/v1 JSON (custom api group: NO CSRF,       │
│                      throttle:api, session cookie auth)             │
│  Envelope.php        { ok, data, error, requestId } builder         │
│  RequestId.php       X-Request-Id validation + echo (all routes)    │
│  LoginRateLimiter    FAILED-login throttle: 5 / 60 s / email+IP     │
│  AlgorithmEngine     fixed catalog, bounded input, hrtime measure   │
│  Eloquent ORM        users, notes, sessions, cache (sqlite/PG)      │
└────────────────────────────────────────────────────────────────────┘
```

## 1. The dual envelope (JSON API vs Livewire page state)

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
   The shape is frozen by `tests/Feature/EnvelopeContractTest.php`.

2. **Livewire pages (web)** — interactions are NOT JSON calls to `/api/v1`;
   they are Livewire round-trips over `/livewire/update` carrying
   `wire:snapshot` + `calls[]` and returning HTML morphs plus effects. The
   "envelope" of a Livewire interaction is the component state itself:
   validation errors flow through Laravel's standard redirected error bag
   / `$this->addError()`, surfaced in Blade with `@error` / `$errors`, NOT
   through the JSON envelope. **Envelope normalization between the two
   surfaces is structural, not literal**: the JSON error codes
   (`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `RATE_LIMITED`)
   map to web-side UX equivalents (inline `@error` messages, `auth`
   middleware redirect to `/login`, 403 page, limiter message rendered by
   the login component) — the same failure taxonomy, two renderings.
   `bootstrap/app.php` keeps `/api/*` exception rendering JSON-only
   (`shouldRenderJsonWhen` + `is('api/*')` guards); web/Livewire responses
   keep Laravel's defaults.

Which dialect a request speaks is decided by the route file it enters
(`routes/api.php` vs `routes/web.php`) — there is no content negotiation in
controllers. The Livewire update endpoint itself is auto-registered by the
Livewire service provider INTO the web group (CSRF-protected), which is
exactly why the tokenless-POST smoke check must yield 419, never 404/405.

## 2. Auth: one session, two surfaces

- Single Laravel session (`stack16_session` cookie, HttpOnly, SameSite=lax,
  database driver). The Livewire/Blade pages and `/api/v1` share it.
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

### 3.1 `/api/v1` runs WITHOUT CSRF middleware — and `/livewire/update` KEEPS it (CSRF-419 lesson)

The custom `api` middleware group (bootstrap/app.php) = EncryptCookies +
cookies + StartSession + `throttle:api` + SubstituteBindings. It deliberately
excludes `ValidateCsrfToken`:

- Native/API clients cannot perform the CSRF token dance (no browser cookie
  jar + token endpoint contract in the four-screen spec).
- Cross-site browser abuse of `/api/v1` writes is mitigated by
  **SameSite=lax**: a cross-site POST from another origin does not carry the
  session cookie, so the forged request is unauthenticated.
- Additional mitigation: the failed-login rate limiter (below) bounds
  credential stuffing against the JSON surface.
- The web group (Blade forms AND Livewire's `/livewire/update`) KEEPS full
  CSRF protection — pinned by
  `ApiMiddlewareWiringTest::test_livewire_update_endpoint_runs_in_the_web_group_with_csrf`.

**CSRF-419 LESSON (inherited from Stack 15, applied 1:1):** the first
implementation of stack 15 mounted `/api/v1` inside `routes/web.php` under
the `web` group. PHPUnit did not catch the resulting 419s because
`ValidateCsrfToken::runningUnitTests()` silently skips token verification
under phpunit; the runtime smoke script caught every write failing with
`CSRF_TOKEN_MISMATCH`. Stack 16 therefore starts with `/api/v1` in
`routes/api.php` (mounted via `withRouting(api:, apiPrefix: 'api/v1')`) and
adds a NEW dimension of the same lesson: **the mirror-image mistake is
equally fatal** — moving `/livewire/update` out of the web group would strip
CSRF from every Livewire action. `ApiMiddlewareWiringTest` pins BOTH sides:
api routes in the api group (no CSRF, throttle present), `/livewire/update`
in the web group (CSRF enforced). LESSON: PHPUnit-side CSRF bypass means
middleware wiring MUST be verified over real HTTP for any stack that skips
CSRF for API routes — and for any stack (like Livewire) that brings its OWN
update endpoint whose group membership is decided by the framework.

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
  header + `RATE_LIMITED` code. On the web surface the login Livewire
  component catches it and surfaces the message via `$this->addError()`.

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
  **The engine is the single source of truth for the bound**: it resolves
  `config('stack.algorithm_max_input')` in its constructor (lowering
  allowed, raising clamped to `ABSOLUTE_MAX_INPUT_LENGTH`, invalid values
  fall back to the 10,000 default), enforces it in `run()`, and both the
  `/api/v1` catalog field and the Livewire workbench render the same
  engine-resolved number (contract-tested).
- Measured duration (`hrtime`, monotonic) and the static Big-O note are
  separate result fields; measured time is never presented as complexity.
- Livewire-specific: `algorithmId` is `#[Locked]` — the browser cannot
  rebind it to an arbitrary value between requests; the run action
  re-validates it against the catalog server-side.
- The `reverse` algorithm (and the palindrome check) reverse by CODE POINT
  (`preg_split('//u')` + `array_reverse`), not byte-wise `strrev`, so
  multi-byte UTF-8 round-trips intact (test-asserted).

### 3.5 Never leaked to clients

Exception renderers map every failure to stable codes
(`VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`RATE_LIMITED`, `INPUT_TOO_LARGE`, `UNKNOWN_ALGORITHM`,
`CSRF_TOKEN_MISMATCH`, `INTERNAL_ERROR`, `HTTP_<status>` fallback); the
`Throwable` renderer reports the real exception server-side (`report($e)`)
and returns the generic envelope. Stack traces/SQL/secrets never reach the
client (test-asserted; smoke also asserts the 419 body is clean when
`APP_DEBUG=false`).

### 3.6 Livewire component hardening (`#[Locked]` + re-authorization)

Livewire public properties round-trip through the browser on every update,
which makes them a mass-assignment surface that classic controllers do not
have:

- `Notes\Form::$noteId` is `#[Locked]` — a client `set()` (or crafted
  snapshot) cannot repoint the form at another user's note id. The
  component re-scopes ownership via the `AuthorizesNote` trait on EVERY
  action (mount, save, delete), so even a stale/mismatched id fails with
  403 rather than silently editing a foreign row.
- `Workbench::$algorithmId` is `#[Locked]` and validated against the fixed
  catalog on every run.
- Server-side validation re-runs on every action; `wire:model.live` is a
  convenience, never a trust boundary.
- Notes search: the user term is a LITERAL substring — LIKE wildcards in
  it (`%`, `_`, `\`) are escaped via `addcslashes` and the `ESCAPE`
  character is passed as a SQL binding, so `50% off` matches `50% off`,
  not every row containing `50<anything>` (test-asserted).

## 4. Data model

Eloquent (the stack's ORM requirement): `users`, `notes`
(`user_id` FK, title ≤ 120, body ≤ 5000, indexed), Laravel's standard
`sessions` + `cache` tables. Ownership is enforced server-side on every
query (`$user->notes()` scope or explicit `authorizeOwner` check → 403
`FORBIDDEN` for foreign notes, never 404-masking). Local/tests run sqlite
(`DB_CONNECTION=sqlite`); production target is PostgreSQL 17 — no raw
sqlite-specific SQL exists in the app code.

## 5. Front-end assembly (TALL)

- **Tailwind CSS 3** (PostCSS pipeline — deliberately v3, the catalog
  contract; `tailwind.config.js` + `postcss.config.js`; utilities in Blade
  templates only, no CSS-in-JS).
- **Alpine 3** is loaded from the Vite bundle (`resources/js/app.js`) and
  used only for presentational state: dismissing the flash banner
  (`x-data`/`x-show`/`x-on:click`), nothing that belongs to the server.
- **Livewire 3** owns all interactive server state: notes list
  (`wire:model.live` debounced search), note detail, note create/edit form,
  algorithm workbench. Full-page components registered as route targets
  (`Route::get('/notes', NotesIndex::class)`) with
  `->layout('components.app-layout')`.
- **Classic Blade controllers** for auth (register/login/logout) and the
  dashboard — plain HTTP form posts where no reactive state is needed.
- Layout: `resources/views/components/app-layout.blade.php`, resolved as
  `<x-app-layout>` via `Blade::anonymousComponentNamespace('components')`
  registered in `AppServiceProvider` (Laravel core registers no default —
  see the §2b history in `verification.md`).
- Asset pipeline: Vite 8 + laravel-vite-plugin 3 (`@vite` in the layout);
  tests run `withoutVite()` so the suite never needs a build.

## 6. Verification entry points

- `laravel/` — PHPUnit feature suite (67 tests, 305 assertions; includes
  17 `Livewire::test()` component tests), `php -l` clean.
- `laravel/scripts/smoke.mjs` — real-HTTP contract walk (67 checks):
  register/login/CRUD/403/throttle/429+Retry-After/request-id echo/CSRF
  wiring/Livewire page mounts/logout revocation. Requires a running
  server; see `verification.md` §4.
- `verification.md` — what ran, what did not, exact commands.

## 7. Stack 15 (Inertia) vs Stack 16 (Livewire) — the contrast this stack exists to show

Both stacks share the same Laravel 12 backend, envelope, auth, throttle and
algorithm engine; the front-end layer is the experiment.

| Dimension | Stack 15 — Inertia 2 + Vue 3 | Stack 16 — Livewire 3 + Alpine 3 |
|---|---|---|
| Rendering | Vue 3 SPA shell, server-side page props | Server-rendered Blade; Livewire morphs DOM in place |
| Client language | TypeScript everywhere | Zero app-authored JS (Alpine directives + Livewire runtime) |
| Data flow | Inertia page props (JSON-ish) per visit | Livewire snapshots/calls over `/livewire/update` |
| API reuse | Pages could call `/api/v1` via the shared TS envelope helper (vitest-covered) | Pages NEVER touch `/api/v1`; the JSON surface exists for API clients only, kept in parallel (same controllers) |
| Error UX | Client-side envelope normalization (`envelope.ts`) | Blade `@error` + `$this->addError()`, standard Laravel error bags |
| Client state | Vue reactivity (refs, computed) | Livewire public properties (server-authoritative, `#[Locked]` for ids) |
| Interactivity cost | Full SPA runtime, router, build-time page splitting | Livewire round-trips per action (network-per-interaction), Alpine for micro-UI |
| Test surface | Vitest for envelope + pages, `ScreenContractTest` for props | `Livewire::test()` actions on the server — no JS test runner needed |
| CSRF story | Inertia form posts in web group (CSRF) | Same, PLUS `/livewire/update` is itself web-grouped CSRF — pinned by test |
| Auth screens | Inertia pages posting to controllers | Classic Blade forms posting to controllers (identical) |

The practical takeaway encoded in the code: **Inertia moves the envelope to
the client (a normalization layer + JS tests); Livewire eliminates the
client data layer entirely (server-side tests replace it), at the price of
a network round-trip per interaction and framework-owned endpoints whose
middleware wiring must be pinned (`ApiMiddlewareWiringTest`).**
