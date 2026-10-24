# Verification — Stack 04 (TASK-007)

**Verified at (local):** 2026-10-24, ~21:30–23:10 UTC+3
**Branch:** `feat/stack-04-go-fiber-htmx-flutter`
**Scope rule:** every claim below is tied to a command that actually ran in
this session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Go | 1.27.0 (windows/amd64) | `go version` |
| Node.js | v24.19.0 (installed, NOT needed by this stack) | `node --version` |
| Docker | CLI 29.1.3, engine 29.1.3 running, BUT compose build/run NOT exercised (see §5) | `docker info --format '{{.ServerVersion}}'` |
| Flutter | **NOT INSTALLED** | task environment (no SDK) |

Framework note: **Fiber v2 is deprecated upstream** ("Fiber v2 has been
superseded by Fiber v3"); this reference implementation uses **Fiber
v3.6.1**, the maintained line. htmx 2.0.4 is vendored into the binary via
`go:embed` (no runtime CDN).

## 2. Backend — `go test ./...` (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/04-go-fiber-htmx-flutter/backend
go build ./...
go vet ./...
go test ./... -count=1
```

Results: **exit 0** for all three; `go vet` clean; **32/32 tests pass**
(9 algorithm + 1 api + 16 app integration + 6 auth).

```text
ok  .../internal/algorithm   0.238s   (9 tests)
ok  .../internal/api         0.384s   (1 test)
ok  .../internal/app         3.372s   (16 tests)
ok  .../internal/auth        0.903s   (6 tests)
```

Full `-v` run list (all `--- PASS`):

- `internal/algorithm` (9): catalog-is-fixed-and-safe, fizzbuzz, palindrome,
  fibonacci (bounded, rejects 91/-1/abc), reverse, rejects unknown
  algorithm, rejects oversized input (10,001 chars; 10,000 accepted),
  measured-duration-vs-complexity separation, injected deterministic clock.
- `internal/api` (1): cookie name contract + handler signatures.
- `internal/app` — API integration (9): envelope shape on success (201 +
  meta) and error (409 EMAIL_TAKEN, data=null, request_id present),
  field-level VALIDATION_ERROR, HttpOnly+SameSite cookie flags on login,
  401 UNAUTHORIZED on all protected endpoints (home/me/algorithm/run),
  register→login→home→run→logout walk with measured execution_ms present,
  login throttle 429 + Retry-After with rotating spoofed XFF (does NOT
  reset the counter) and correct-login-still-429, enumeration parity
  (wrong password == unknown email: same status/code/message), unknown
  algorithm (400) + oversized input (413 INPUT_TOO_LARGE), 256KB body
  limit (413 rejection path).
- `internal/app` — web integration (7): register/login pages render with
  accessible labels, root redirect, protected-page 303 + htmx 401 +
  HX-Redirect, full browser walk (register form → login form → home shows
  email → algorithm page shows catalog → run shows output + "Measured
  duration" + "Theoretical complexity" separately → logout kills session),
  visible form errors (field-level + banner, 422), throttled web login
  shows the rate-limit error, htmx fragment mode (422 fragment with
  `login-form` id, 204 + HX-Redirect on success, run swaps the result
  fragment — never a full page).
- `internal/auth` (6): happy path, throttle buckets keyed email+IP with XFF
  spoofing rejected and success-clears-tally, session expiry after TTL,
  logout invalidates server-side, duplicate email maps to ErrEmailTaken,
  validation aggregates both field errors.

Issues found and fixed during real runs (all resolved, suite green):

1. Fiber v2 (initially pinned) is deprecated — migrated to v3.6.1; v3 API
   differences handled: `c.Locals(key, val)` key-value form, redirect
   responses are 303 (See Other), `fiber.App.Test` for httptest-style
   integration, `Set-Cookie` written explicitly so flags match the
   documented contract exactly.
2. `api.Handlers.SecureCookies` was nil in app wiring (nil func call → 500
   on login). Fixed by injecting the flag policy at construction; covered
   by `TestLoginSetsHttpOnlySessionCookie` (would fail on regression).
3. Template layout rewritten: each page is a self-contained
   `{{define "..."}}` document (no nested define), fragments separate.
4. Test harness: `do()` now lets callers override Content-Type so web form
   posts are real `application/x-www-form-urlencoded` requests.

## 3. Web (server-rendered htmx) — covered by REAL tests

There is no separate web build step (this is the stack's point): the pages
are Go `html/template` documents rendered by the same binary. Rendering and
behavior are asserted by the 7 web integration tests listed above (full
HTML documents, htmx `hx-post` hooks present, fragment mode never returns a
full page, errors visible with `role="alert"` + `.field-error`, measured
duration and Big-O shown as separate labeled lines).

htmx 2.0.4 vendored: `backend/internal/app/static/htmx.min.js` (50,917
bytes), served from the embedded FS at `/static/htmx.min.js`.

## 4. Real server smoke test (REAL, PASSED)

Command (exact, PowerShell):

```powershell
$env:PORT='18080'; go run ./cmd/backend
# then, from another shell:
Invoke-WebRequest http://localhost:18080/healthz
Invoke-WebRequest http://localhost:18080/login
[System.Net.HttpWebRequest]::Create('http://localhost:18080/home') with AllowAutoRedirect=$false
```

Observed:

```text
healthz    → 200 {"status":"ok"}
login page → 200, <!DOCTYPE html>...
/home anonymous → 303 (redirect to /login)
```

(The first attempt on port 8080 hit an unrelated local JHipster dev server
already bound to that port; re-ran on 18080. No environment changes made.)

## 5. Docker Compose (DECLARED, NOT RUN — unverified)

`docker info` reports engine 29.1.3 running, but **`docker compose build`
and `docker compose up` were NOT executed in this session**; `docker-compose.yml`
and `backend/Dockerfile` are declarative and marked unverified in
`stack.json`. The compose file builds the single backend service (no
database in this stack's reference scope — the store decision is documented
in ARCHITECTURE.md §3) and publishes only port 8080. The first real
`docker compose up --build` is its verification run.

## 6. Mobile — Flutter (NOT RUN — SDK missing)

**UNVERIFIED — `flutter pub get` / `flutter analyze` / `flutter test` COULD
NOT BE EXECUTED because the Flutter SDK is not installed.** No version,
build, or test claim is made for `frontend-mobile/`. The Dart code maps the
four journeys to screens against the frozen `/api/v1` contract (see
`frontend-mobile/README.md`) and has never been compiled. First actions
when the SDK is available: `flutter pub get && flutter analyze && flutter
test`.

## 7. Security review notes

- No secrets committed: the stack needs none (in-memory store; `.env.example`
  has placeholders only; `docker-compose.yml` carries no credentials).
- Envelope error responses never include stack traces or internals
  (stable codes + safe messages; Fiber recover middleware in front).
- Passwords: bcrypt (golang.org/x/crypto v0.58.0, default cost); never
  logged or returned; enumeration parity is test-asserted.
- Sessions: 256-bit crypto/rand opaque ids, 30-minute expiry, server-side
  revocation on logout (test-asserted); cookie HttpOnly + SameSite=Lax,
  `Secure` behind TLS via `COOKIE_SECURE=true`.
- Login throttle: 10 failed attempts / 60s pinned window per email+IP,
  in-process, demo-grade and documented as such; 429 + Retry-After; XFF
  ignored unless the peer is a configured trusted proxy (spoofed-XFF test
  asserts no bypass; correct login from a throttled identity stays 429).
- CSRF: SameSite=Lax for the server-rendered forms (all state-changing web
  posts are same-site); no CORS headers emitted; no cross-origin browser
  client in scope. Trade-off documented in ARCHITECTURE.md §3.
- Algorithm workbench: fixed catalog only, closed-switch dispatch, no
  code-input path (unit-test asserted); input bounded at 10,000 chars +
  per-algorithm numeric ranges; request bodies capped at 256KB (413).
- Logs: no request bodies, passwords, cookies, or authorization headers.

## 8. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Flutter analyze/test | **UNVERIFIED** | SDK not installed |
| Docker compose build/run | **UNVERIFIED** | not exercised this session (engine running, but the build was not run) |
| Browser e2e (Playwright) | not implemented | out of TASK-007 scope; web behavior covered by HTTP-level integration tests |
| Automated a11y audit | not implemented | out of scope (labels/roles hand-checked in templates) |
| Persistent database | intentionally none | documented in-memory decision (ARCHITECTURE.md §3); `store.Store` is the seam |
| Horizontal scaling | intentionally out | in-process sessions/throttle; seams exist for shared backends |

## 9. stack.json verification flags

- `manifest`: **true** — structure matches `schemas/stack-manifest.schema.json`
  (id pattern, maturity enum, verification block; CI validate-catalog
  re-checks against the catalog).
- `unit`: **true** — 16 unit tests (algorithm 9 + api 1 + auth 6) really ran green.
- `integration`: **true** — 16 httptest integration tests over the real
  `app.New()` wiring really ran green (API + web surfaces).
- `e2e`: **false** — no automated browser/native e2e was run.
- `lastVerifiedAt`: 2026-10-24T20:15:00Z (UTC timestamp of the green run).
- `evidencePath`: `verification.md` (this file).
