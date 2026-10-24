# Stack 04 Architecture — Go 1.27 / Fiber v3 + htmx + Flutter

## 1. Identity and maturity

- **ID:** `04-go-fiber-htmx-flutter`
- **Name:** Go / Fiber / Htmx / Flutter
- **Category:** `enterprise-cross-platform`
- **Maturity:** `scaffolded` (gate-by-gate evidence in verification.md)
- **Owner:** TASK-007 reference implementation session
- **Last verified (UTC):** 2026-10-24
- **Supported OS (tested):** Windows 11 (backend + web rendering via tests).
  Mobile is untested (no Flutter SDK); compose untested (no daemon at
  implementation time — CLI present, engine available but the full build/run
  was not exercised).
- **License notes:** Fiber (MIT), htmx (BSD-2, vendored minified), x/crypto
  (BSD-3), testify (MIT), uuid (MIT). No license conflicts.

## 2. Technology and compatibility matrix

| Component | Target version | Tested version | Evidence | Notes |
|---|---|---|---|---|
| Language/runtime | Go 1.27 | 1.27.0 (windows/amd64) | `go version`, real `go test ./...` | |
| Backend framework | Fiber v3 | v3.6.1 | real tests via `fiber.App.Test` | v2 is deprecated upstream; v3 is the maintained line |
| Web front end | htmx 2 + Go html/template | htmx 2.0.4 (vendored), Go 1.27 templates | real render tests | server-rendered; NO SPA |
| Mobile | Flutter (stable) | NOT TESTED — no SDK | none | code targets the documented contract |
| Data store | in-memory (Go maps) | real tests | `internal/store` | documented decision below |
| Password hashing | bcrypt | golang.org/x/crypto v0.58.0 | real tests | default cost 10 |

## 3. Architecture

### Process boundaries

- ONE Go binary serves everything: the JSON API under `/api/v1/**`, the
  server-rendered htmx pages under `/`, and static assets from an embedded
  FS. There is no Node build step, no SPA bundle, no separate web server.
- The Flutter app is a separate client (not implemented here beyond the
  contract-bound screen map in `frontend-mobile/`).

### Module layout

```text
backend/
├── cmd/backend/main.go          # entry point (PORT, COOKIE_SECURE, TRUSTED_PROXIES)
└── internal/
    ├── app/                     # wiring: routes, middleware, error handler (+ tests)
    ├── api/                     # /api/v1 handlers, envelope, cookie helpers
    ├── web/                     # server-rendered pages (html/template + htmx hooks)
    │   └── templates/           # 4 pages + form/result fragments
    ├── auth/                    # register/login/logout use-cases (+ tests)
    ├── algorithm/               # fixed catalog engine, bounded input (+ tests)
    ├── throttle/                # failed-login limiter (pinned window)
    ├── clientip/                # XFF policy resolver
    ├── validation/              # shared input rules
    ├── envelope/                # section-7 response envelope
    └── store/                   # Store interface + in-memory impl
```

### API boundary and DTOs

Every JSON response uses the repository envelope from
`docs/PRODUCT_REQUIREMENTS.md` section 7 (`success` / `data` / `error` /
`meta` with `timestamp`, optional `execution_ms`, `request_id`), implemented
once in `internal/envelope` and asserted by integration tests.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/register` | public | create account (201), 409 on duplicate |
| POST | `/api/v1/login` | public | create session cookie, 429 when throttled |
| POST | `/api/v1/logout` | public (idempotent) | invalidate server-side session |
| GET | `/api/v1/me` | session | current profile |
| GET | `/api/v1/home` | session | profile + safe sample metrics |
| GET | `/api/v1/algorithm` | session | fixed algorithm catalog |
| POST | `/api/v1/algorithm/run` | session | run one bounded fixed algorithm |
| GET | `/healthz` | public | liveness |

Error codes are stable strings: `VALIDATION_ERROR`, `EMAIL_TAKEN`,
`INVALID_CREDENTIALS`, `RATE_LIMITED`, `UNAUTHORIZED`, `UNKNOWN_ALGORITHM`,
`INPUT_TOO_LARGE`, `INTERNAL_ERROR`.

### Web front end (the stack's differentiator)

- All four screens are **server-rendered** `html/template` documents:
  register, login, home (protected), algorithm workbench (protected).
- htmx (vendored `htmx.min.js`, no CDN at runtime) progressively enhances
  the forms: `hx-post` + fragment swap (`login-form`, `register-form`,
  `run-result`). Without JavaScript the same forms post and render full
  pages — the screens work with JS disabled.
- Form errors are server-rendered and visible: field-level messages
  (`.field-error`), banner errors (`.error`, `role="alert"`), and the 401
  surface (page redirect to `/login?flash=login-required`; htmx requests get
  `401 + HX-Redirect: /login`). Rate limiting is **HTTP 429 + `Retry-After`**
  on the web path too — same status and header as the JSON API — and the
  message stays visible in both full-page and htmx fragment mode. The
  vendored htmx 2.0.4 does not swap 4xx bodies by default, so every page
  declares a `htmx-config` meta that enables swapping for 422/429 responses
  (the error contract relies on it; the API's 429 is otherwise invisible in
  the browser).
- Loading states are native browser behavior for full-page posts; htmx mode
  disables the submit button while the request is in flight (CSS
  `htmx-request` + disabled state).

### Data store — the documented decision

**In-memory, thread-safe (single RWMutex), process-local.** Reasons:

1. The verification target is `go test ./...` with real integration tests —
   reproducible from a clean checkout with Go alone, no external services.
2. SQLite would add either a CGO toolchain requirement on Windows
   (mattn/go-sqlite3) or a large pure-Go dependency tree (modernc.org),
   against the task's "minimal, versioned go.mod" constraint.
3. The four-screen contract needs no durability at `scaffolded` maturity.

Consequences (accepted and documented): data is lost on restart; single
process only. The `store.Store` interface is the seam for a real database
(e.g. pgx/PostgreSQL) later. Session records expire after 30 minutes and are
deleted lazily.

### Auth/session model (the documented auth decision)

- **Server-side sessions, not JWT.** Sessions are revocable server-side
  (`POST /api/v1/logout` deletes the record — test-asserted), and no refresh
  machinery is needed at this scope. Session ids are 256-bit crypto/rand
  values (base64url); nothing about the id leaks the account.
- **Cookie:** `STACK04_SESSION`, HttpOnly, SameSite=Lax, Path=/, Expires =
  30 minutes after login. `Secure` is added when `COOKIE_SECURE=true`
  (TLS deployments). The cookie value is a random token, not a JWT.
- **Passwords:** bcrypt (`golang.org/x/crypto/bcrypt`, default cost);
  hashes never leave the store and never appear in any response.
- **Enumeration defense:** unknown email and wrong password return the same
  status (401), code (`INVALID_CREDENTIALS`) and message — asserted by a
  dedicated integration test.
- **Login throttle (demo-grade, documented):** only FAILED attempts consume
  budget, keyed on email + client IP (an attacker cannot lock out a victim
  by burning only the victim's email; one IP cannot silently try many
  emails). The window is PINNED (fixed start) — not sliding. Exceeding the
  limit returns **HTTP 429 + `Retry-After: 60`**, and a correct login from a
  throttled identity is still 429 (test-asserted). Success clears the tally.
  A dedicated test proves rotating spoofed `X-Forwarded-For` values does NOT
  reset the counter.
- **Client IP / X-Forwarded-For policy:** XFF is honored only when the
  immediate TCP peer matches `TRUSTED_PROXIES` (exact IP or simple prefix
  like `10.0.`); the default is EMPTY, which ignores XFF entirely and uses
  the peer address. In trusted-proxy mode the chain is walked right-to-left
  and the first untrusted hop is the client (identical to Stack 01's
  reviewed design).
- **CSRF strategy:** SameSite=Lax cookies are the primary CSRF defense for
  the htmx pages (all state-changing web posts are same-site form posts;
  cross-site requests do not carry the cookie). The JSON API is intended for
  non-browser clients (mobile) that do not accept cookies implicitly; no
  cross-origin site is allowed by default and no CORS headers are emitted.
  This is a deliberate, documented trade-off for the reference scope; a
  token-echo scheme would be added together with any cross-origin browser
  client.
- **Request bounds:** Fiber `BodyLimit` 256KB; register/login/algorithm
  inputs validated server-side; algorithm input capped at 10,000 chars.

### Algorithm workbench

- Fixed catalog of 4 algorithms (fizzbuzz, palindrome, fibonacci, reverse)
  compiled into the binary. `Run` dispatches on a closed switch — there is
  no code-input path, no dynamic dispatch, no user-code execution (unit
  test asserts catalog safety and rejects unknown ids).
- Input bounds: 10,000 chars hard cap plus per-algorithm numeric ranges
  (fizzbuzz n∈1..1000, fibonacci n∈1..90 for uint64 safety).
- `execution_ms` is measured with `time.Since` over a monotonic clock and
  rounded to 0.1 ms — never claimed at microsecond precision. Theoretical
  Big-O (`complexity` + `explanation`) travels as separate fields; the UI
  shows both side by side with an explicit note that measured time does not
  prove complexity.

## 4. Four-screen mapping

| Requirement | Server-rendered screen | Server-side protection | Tests |
|---|---|---|---|
| Register | `/register` (form + htmx fragment) | validation, bcrypt, unique email, 409 | `TestRegisterValidationErrorsAreFieldLevel`, `TestWebFormErrorsAreVisible` |
| Login | `/login` (form + htmx fragment) | throttle, generic failure, session cookie | `TestLoginSetsHttpOnlySessionCookie`, `TestLoginThrottleReturns429WithRetryAfter`, `TestWebThrottledLoginShowsError` |
| Home | `/home` (protected page) | backend session required; redirect/HX-Redirect otherwise | `TestWebProtectedPageRedirectsToLogin`, `TestWebRegisterLoginHomeFlow` |
| Algorithm | `/algorithm` (protected page + run fragment) | session required; fixed catalog; bounded input | `TestAlgorithmUnknownAndOversized`, `TestWebHtmxFragments` |
| Logout/revocation | nav form on every page | server-side invalidation | `TestLoginSuccessGrantsProtectedAccess`, `TestWebRegisterLoginHomeFlow` |

## 5. Environment variables

| Name | Purpose | Required | Default | Secret | Consumer |
|---|---|---|---|---|---|
| `PORT` | listen port | no | `8080` | no | backend |
| `COOKIE_SECURE` | add `Secure` to the session cookie (TLS deployments) | no | `false` | no | backend |
| `TRUSTED_PROXIES` | comma-separated proxies allowed to set XFF | no | empty (XFF ignored) | no | backend |

`.env.example` documents all of them; none is a secret. The stack needs no
credentials: no database, no third-party services.

## 6. Local setup (tested on Windows 11)

```powershell
# prerequisites: Go 1.27 (Flutter SDK NOT required; Node not required)
go version          # go1.27.0 windows/amd64

cd stacks/04-go-fiber-htmx-flutter/backend
go build ./...      # compiles
go test ./...       # 31/31 passing
go run ./cmd/backend  # serves :8080 (API + web screens)
```

Then open `http://localhost:8080/register` in a browser.

## 7. Security summary

- Input validation: shared rules in `internal/validation`, re-checked at the
  engine boundary (defense in depth); oversized bodies rejected by Fiber's
  256KB `BodyLimit` (413) — test-asserted.
- AuthN: bcrypt + opaque server-side sessions (see §3).
- AuthZ: `RequireSession` middleware guards every protected endpoint with
  401; pages additionally redirect unauthenticated browsers.
- CORS: none emitted (same-origin web + non-browser API clients by design).
- Rate limits: failed-login throttle per email+IP, pinned window, 429 +
  Retry-After, XFF-spoof-proof by default (demo-grade, documented).
- Secrets: none committed; `.env.example` placeholders only; the store holds
  no secrets (bcrypt hashes + random session ids).
- Logging: the reference server does not log request bodies, passwords,
  cookies, or authorization headers.
- Static assets: htmx 2.0.4 vendored into the binary (no runtime CDN);
  served with a scoped Cache-Control header.

## 8. Testing and acceptance

- Unit tests: `internal/algorithm` (9) — catalog safety, bounded inputs,
  measured-vs-theoretical separation, injected deterministic clock.
- Unit tests: `internal/auth` (6) — happy path, throttle buckets + XFF
  spoofing, session expiry, logout revocation, duplicate email, field-error
  aggregation.
- Integration tests: `internal/app` (16) — the real `app.New()` fiber app
  driven through `fiber.App.Test`: envelope contract on success/error,
  field-level validation, HttpOnly cookie flags, 401 on all protected
  endpoints, register→login→home→run→logout walk, 429 + Retry-After +
  no-throttle-bypass, enumeration parity, unknown algorithm, oversized
  input, body limit, web page flows, htmx fragment mode.
- `go vet ./...` clean; `git diff --check` clean.
- Not covered: browser e2e (out of scope), Flutter (no SDK), compose build
  (no daemon at implementation time).

## 9. Known gaps / limitations

- In-memory store: restart wipes accounts/sessions (documented decision).
- Throttle and sessions are single-process; horizontal scaling needs the
  store/throttle seams to be backed by shared infrastructure.
- No automated browser e2e or a11y audit; labels/roles are hand-checked.
- Flutter mobile: contract-bound code only — UNVERIFIED (no SDK).
- docker-compose/Dockerfile: declarative — UNVERIFIED (no daemon exercised).
