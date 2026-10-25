# Architecture — Stack 17 (Laravel 12 + Inertia 2 + React + React Native)

Reference implementation of catalog entry `17-laravel12-react-inertia-reactnative`.
This document records the decisions a reader needs to understand the code;
verification evidence lives in `verification.md`.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Browser (React 19 via Inertia)        React Native thin shell (mobile/) │
│   server-rendered page visits           JSON over /api/v1               │
│   Inertia useForm (error-bag dialect)   shared ApiClient (envelope)     │
│        (no client API layer)          (mobile/, NOT VERIFIED)           │
└──────────────┬──────────────────────────────┬───────────────────────────┘
               │ same Laravel session         │ same Laravel session
               │  (stack17_session cookie)    │  (cookie replayed)
               ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Laravel 12 (laravel/)                                                   │
│  routes/web.php      Inertia pages (web group: sessions + CSRF)         │
│  routes/api.php      /api/v1 JSON (custom api group: NO CSRF,           │
│                      throttle:api, session cookie auth)                 │
│  Envelope.php        { ok, data, error, requestId } builder             │
│  RequestId.php       X-Request-Id validation + echo (all routes)        │
│  LoginRateLimiter    FAILED-login throttle: 5 / 60 s / email+IP         │
│  AlgorithmEngine     fixed catalog, bounded input, hrtime measure       │
│  Eloquent ORM        users, notes, sessions, cache (sqlite/PG)          │
└─────────────────────────────────────────────────────────────────────────┘
                  ▲
                  │ imported by both web pages (types) and the RN shell
┌─────────────────────────────────────────────────────────────────────────┐
│ shared/ (transport-agnostic TypeScript)                                 │
│  src/envelope.ts     parseEnvelope / normalizeEnvelope / ApiError       │
│  src/api-client.ts   ApiClient: notes CRUD + algorithm + auth,          │
│                      injectable fetch transport, bounded payloads       │
└─────────────────────────────────────────────────────────────────────────┘
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
   consumed by the shared TypeScript layer
   (`shared/src/envelope.ts` + `api-client.ts`), which is the single
   contract surface for the React Native shell.

2. **Inertia pages (web)** — responses are real HTML round-trips; the
   "envelope" is Inertia's page props: shared props from
   `app/Http/Middleware/HandleInertiaRequests.php` (auth user, flash
   status/result) plus per-page props. Validation errors flow through
   Laravel's standard redirected error bag, NOT through the JSON envelope.

Which dialect a controller method speaks is decided by `$request->is('api/*')`
(e.g. `NoteController@show`, `RegisteredUserController@store`). Exception
rendering follows the same split in `bootstrap/app.php`: everything mapped
to the envelope for `api/*`, plain HTTP semantics for web.

## 2. Frontend strategy: Inertia + React, two dialects, deliberately

The Inertia pages (React TSX in `laravel/resources/js/pages/`) intentionally
do NOT use the shared ApiClient for their form flows. This is the core
frontend decision of this stack:

- **Web pages speak Inertia's dialect**: `useForm` + `route()` + full page
  visits. Laravel's redirected error bag is the error transport; flash
  messages and the workbench result ride the session. No `fetch`, no client
  API layer, no manual token handling.
- **The shared layer speaks the JSON dialect**: `parseEnvelope` +
  `ApiClient` with an injectable `fetch`. It is the contract surface for
  direct fetches and the React Native shell.
- **What IS shared**: the page-prop TYPES (`resources/js/types.ts` mirrors
  the shared prop shapes) and the envelope/`ApiClient` module itself
  (imported by the RN shell via the shared package). Web pages import the
  types, not the client — merging the two dialects into one client would
  force the Inertia pages to hand-roll what `useForm` gives for free
  (error bags, redirect handling, preserveState), while giving the RN shell
  nothing it needs (it cannot use Inertia visits at all).

### 2.1 Vue (stack 15) vs React (stack 17) under Inertia — what actually differs

Stack 15 (Vue 3) and stack 17 (React 19) implement the same four-screen
journey over the same backend contract. The Inertia protocol is
frontend-agnostic; the differences are all in the page component layer:

| Aspect | Vue 3 (`@inertiajs/vue3`, stack 15) | React 19 (`@inertiajs/react`, stack 17) |
|---|---|---|
| SFC vs TSX | Single-file components (`Pages/*.vue`), template-first | TSX functions (`pages/**/*.tsx`), render is the return value; composition via hooks |
| Form state | `useForm` composable; reactivity is built into the framework — `form.email` mutates and the template follows | `useForm` hook — but it returns a plain object whose `data` changes trigger re-render through React state; controlled inputs (`value=` + `onChange=`) are MANDATORY. Forgetting `onChange` makes the input read-only (React warns, jsdom silently blocks typing) |
| Conditional rendering | `v-if` / `v-else` directives in the template | `{cond && (...)}` / ternaries in TSX |
| Error display | `form.errors.email` in template, `v-if` | `errors.email` in JSX; same error-bag keys, same messages |
| Route URLs | `route()` global (Ziggy injected via `@routes`) | identical: `route()` global — Ziggy works the same for both frameworks |
| Page resolution | `resolvePageComponent('./Pages/${name}.vue', import.meta.glob(...))` | `resolvePageComponent('./pages/${name}.tsx', import.meta.glob(...))` — note the glob can sweep test files into the production bundle; stack 17 excludes them with a negative glob pattern |
| Testing dialect | Vue Test Utils, mounting SFCs | @testing-library/react + `vi.mock('@inertiajs/react')`; mocking `useForm` needs REAL React state behind it (see §2.2) |
| SSR entry | `app.js` (createSSRApp) | `app.tsx` (`createRoot` from `react-dom/client`) — note `createRoot` comes from `react-dom/client`, NOT `react`; React 19 removed the legacy render() API entirely |
| Type story | SFC props via `defineProps` + runtime declarations; strict typing of page props needs extra tooling | TSX is TypeScript-first: page props are plain interfaces (`types.ts`), `tsc --noEmit` checks the whole page tree with no extra tooling |

**The lesson: Inertia 2 makes the backend identical; the page dialect
(Vue vs React) changes testing strategy and typing ergonomics, not the
wire format.** Everything verified about the backend contract in stack 15
(envelope, throttle, CSRF split) carried over unchanged, and the
React-specific risks (controlled inputs, glob sweeping tests, `createRoot`
import source) live entirely in the page/test layer.

### 2.2 Page tests: mocking `useForm` honestly

`pages.test.tsx` mocks `@inertiajs/react` but backs the `useForm` mock with
REAL React state (`useState`). A plain mutable object mock silently breaks
under React 19: controlled inputs revert to the initial value on the next
render, jsdom's HTML5 constraint validation (`required` attributes) blocks
the submit event, and the test fails with "post not called" — which looks
like a page bug but is a test-harness bug. The React-state-backed mock
makes `setData` trigger a real re-render, so typing into fields, the
`required` select, and the submit path behave as they would in a browser.

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

**History (inherited pre-emptively from stack 15):** stack 15's first
implementation mounted `/api/v1` inside `routes/web.php` under the `web`
group. PHPUnit did not catch the resulting 419s because
`ValidateCsrfToken::runningUnitTests()` silently skips token verification
under phpunit; the runtime smoke script against a real `php -S` server
caught every write failing with `CSRF_TOKEN_MISMATCH`. Stack 17 started
from the fixed shape (routes in `routes/api.php`, separate `api` group,
`ApiMiddlewareWiringTest` pinning the wiring) — and the first smoke run
passed 53/53 on the first try, no 419s. LESSON re-confirmed: middleware
wiring for CSRF-skipping API groups MUST be verified over real HTTP; the
PHPUnit bypass makes the suite blind to it.

### 3.2 Rate limiting (three layers, different jobs)

| Layer | Where | Key | Budget | Response |
|---|---|---|---|---|
| `throttle:api` | whole `/api/v1` group | user id or IP | 240/min | 429 `RATE_LIMITED`, coarse abuse guard |
| `throttle:auth-ip` | register + login only (review follow-up) | client IP | 30 POSTs/min (env `AUTH_IP_THROTTLE_LIMIT`, window fixed 60 s) | 429 `RATE_LIMITED` + `Retry-After` |
| `LoginRateLimiter` | login only | lowercased email + client IP | 5 FAILED attempts / 60 s (fixed window, array/database cache via `LOGIN_THROTTLE_STORE`) | 429 `RATE_LIMITED` + `Retry-After` |

The per-IP auth limiter closes the hole the email+IP keying leaves open:
one address rotating UNLIMITED emails at 5 failures each (credential
stuffing) or mass-creating accounts. It is checked before validation runs,
applies to every register/login POST regardless of outcome, and is scoped
to the unauthenticated auth endpoints only (authenticated data routes do
not consume the budget — pinned by `ApiMiddlewareWiringTest`). Demo-grade
by design; production should also enforce limits at the edge.

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
client (test-asserted). The `FORBIDDEN` code remains part of the stable
contract for any future 403; note ownership no longer produces it (§4 —
foreign notes read exactly like missing ones).

## 4. Data model

Eloquent (the stack's ORM requirement): `users`, `notes`
(`user_id` FK, title ≤ 120, body ≤ 5000, indexed), Laravel's standard
`sessions` + `cache` tables. Ownership is enforced server-side on every
query (`$user->notes()` scope or the owner check in NoteController →
**404 `NOT_FOUND` for foreign notes** — identical to a missing id, so
note ids carry no existence oracle; review follow-up, originally 403
`FORBIDDEN`). Lists are bounded server-side (`?limit=` default 50 / max
100 + `?page=`, pagination metadata in the envelope; review follow-up).
The web list is pager-driven by the same existence-backed flags
(`total`/`hasMore`): "Older notes" renders only when another page exists,
"Newer notes" when `page > 1` — a full last page is never a link signal.
Local/tests run sqlite (`DB_CONNECTION=sqlite`); production target is
PostgreSQL 17 — no raw sqlite-specific SQL exists in the app code.

## 5. React Native thin shell (mobile/ — NOT VERIFIED) + shared strategy

**Shared-layer strategy:** `stacks/17-laravel12-react-inertia-reactnative/shared/`
is a standalone TypeScript package (own `package.json`, own vitest suite)
imported by BOTH consumers:

- the React Native thin shell (`mobile/App.tsx`) imports the `ApiClient`
  + envelope normalizer directly — it has no Inertia, no router, no build
  system beyond the Expo bundler, so it needs the JSON dialect only;
- the web pages import only the page-prop types (mirrored in
  `laravel/resources/js/types.ts`) — they speak the Inertia dialect
  (§2) and deliberately do not fetch.

The shared client is transport-agnostic: the constructor takes a
`fetch`-like transport (default: global `fetch`), so the RN shell can pass
its runtime's fetch without adapter code, and tests stub it. Payloads are
bounded (title 120 / body 5000 / input 10000) and validated client-side
before any request, mirroring the server's validation bounds.

The RN shell (`mobile/`) is a thin four-screen journey — Register →
Login → Home (+ Notes CRUD) → Workbench — over the shared client:

- `App.tsx` — screen state machine, session cookie captured from
  `Set-Cookie` and replayed on every request (in a real deployment:
  persisted via `expo-secure-store`, never plain preferences);
- `app.json` — Expo config, `stack17_session` cookie contract documented;
- `README.md` — declares the **UNVERIFIED** status honestly.

The Expo/React Native toolchain was not available in the implementation
environment: `mobile/` dependencies are declared but never fetched; the
shell has NEVER been compiled, bundled, or run (see `verification.md` §5).
The shared module it imports IS tested (15 vitest tests) and the wire
format it speaks IS verified end-to-end (PHPUnit + two HTTP smoke suites).

## 6. Verification entry points

- `laravel/` — PHPUnit feature suite (54 tests), `tsc --noEmit` clean.
- `laravel/scripts/smoke.mjs` — real-HTTP API contract walk (53 checks):
  register/login/CRUD/404-foreign-note/throttle/429+Retry-After/request-id echo/logout
  revocation.
- `laravel/scripts/smoke-web.mjs` — real-HTTP web-flow walk (16 checks):
  Inertia shell rendering, Ziggy `route()` injection, CSRF + session web
  register/login/notes/logout, post-logout revocation.
- `shared/` — vitest (15 tests) for envelope + ApiClient.
- `laravel/resources/js/pages/pages.test.tsx` — vitest (9 tests) for page
  behavior.
- `verification.md` — what ran, what did not, exact commands.
