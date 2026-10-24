# Verification — Stack 21 (Django 5 + htmx + Alpine + Tailwind)

**Verified at (local):** 2026-10-24, 23:00 – 2026-10-25 00:45 UTC+3
**Branch:** `feat/stack-21-django5-htmx-alpine-tailwind`
**Scope rule:** every claim below is tied to a command that actually ran in this
session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Python | 3.13.2 | `python --version` |
| Django | 5.2.18 (LTS line, pinned `<6.0`) | `pip show django` |
| pip | 25.3 | `pip --version` |
| htmx | 2.0.4 (vendored, 50,917 bytes) | unpkg download + size/content check |
| Alpine.js | 3.14.9 (vendored, 44,758 bytes) | jsdelivr download + size/content check |
| Tailwind CSS | 3.4.17 standalone CLI (Windows x64) | GitHub release download; built output committed |
| Docker | not needed by this stack | — |

Note: the venv initially resolved Django 6.1.2 from the open constraint; the
implementation targets Django 5 per the task and is pinned `django>=5.2,<6.0`.

## 2. Unit + integration — `manage.py test` (REAL, PASSED)

Command (exact, from `stacks/21-django5-htmx-alpine-tailwind/django`):

```powershell
..\..\.venv\Scripts\python.exe manage.py test
```

Result: **Ran 46 tests — OK** (exit 0).

Coverage by class:

- `AuthTests` (8): register 201 + auto-login, invalid email/weak password 422
  with field details, duplicate email → 422 EMAIL_TAKEN (no exception leak),
  login sets HttpOnly + SameSite=Lax `stack21_session` cookie, wrong password
  401 INVALID_CREDENTIALS, unknown-email/wrong-password enumeration parity
  (same code AND message), logout revokes the session server-side (me → 401),
  all protected endpoints answer 401 UNAUTHENTICATED anonymously.
- `EnvelopeTests` (6): `{ok,data,error,requestId}` exact key set on success
  and error, X-Request-Id echoed when `^[A-Za-z0-9-]{1,64}$`, replaced by an
  opaque 32-hex id when invalid or >64 chars, oversized body → 413
  PAYLOAD_TOO_LARGE.
- `ThrottleTests` (5): 5 failures answer 401 then the 6th attempt is 429
  THROTTLED + Retry-After ≥ 1, a correct login from a throttled identity stays
  429, a successful login clears the tally (next 5 failures 401, 6th 429),
  varying spoofed X-Forwarded-For does NOT reset or bypass the counter
  (TRUSTED_PROXIES empty by default), the web login path mirrors the API
  (failed attempts 422 form re-render, 6th attempt 429 + Retry-After with the
  form still rendered).
- `HtmxTests` (9): register htmx failure → 422 fragment (no `<html>`,
  `id="register-form"` present) vs full-page 422 document without the header;
  htmx login success → 204 + HX-Redirect:/home/; non-htmx login success → 302;
  anonymous protected page: htmx → 401 + HX-Redirect, full page → 302;
  algorithm run via htmx swaps the result fragment with "Measured duration"
  and "Theoretical complexity" shown separately; every page carries the
  `htmx-config` meta enabling 422/429 swapping (the Stack-04 lesson, pinned by
  test so it cannot silently regress).
- `NoteCrudTests` (4): create/list/update/get/delete roundtrip over the ORM,
  422 VALIDATION_ERROR on empty title, other user's note → 404 on GET and
  DELETE (owner-scoped, no existence oracle, row survives), ORM-level
  `user.notes` scoping.
- `AlgorithmTests` (6): catalog is exactly the fixed five, fizzbuzz output
  table, palindrome, fibonacci bounded (91 rejected, 10 ok), unknown algorithm
  rejected, view-level oversized input 413 with the 10,000-char boundary
  accepted.
- `AdminTests` (3): django.contrib.admin active, `Note` and `User` registered
  on the site, /admin/login/ reachable, a logged-in staff superuser gets the
  Note changelist (200).
- `WebScreensTests` (5): register + login render anonymously, home +
  algorithm render authenticated, home shows the email and metrics, register
  page has accessible `<label for=id_email/id_password>`, vendored/built
  static assets exist and are non-trivial (htmx content sniffed), URL names
  resolve (`core:login` → `/login/`, `core:api-notes` → `/api/v1/notes`).

Issues found and fixed during real runs (all resolved, suite green):

1. Django 6.1.2 auto-installed first — pinned to `django>=5.2,<6.0` (5.2.18).
2. `UserManager.create_user()` still required the positional `username` after
   swapping `USERNAME_FIELD` to email — wrote a `BaseUserManager` subclass
   (`core/models/user.py`); migration `0002_alter_user_managers` generated.
3. `{% url 'core:...' %}` failed with `NoReverseMatch: 'core' is not a
   registered namespace` because `app_name` sat in the root urlconf — moved
   app routes into `core/urls.py` with `app_name = "core"` and included it.
4. Unknown-email login crashed with `NameError: make_password` — the
   timing-equalizer path imported `check_password` but not `make_password`;
   both now imported at the top of `_attempt_login`.
5. Initial throttle semantics returned 429 ON the Nth failure; aligned to the
   sibling stacks (attempts 1..N get 401, N+1 gets 429) and re-tested.
6. Test-suite coupling: the module-level in-process throttle carried failure
   tallies across test cases — added `ThrottleResetMixin` clearing the buckets
   in `setUp`; and the login-view-created session row does not survive
   TestCase's per-test transaction bookkeeping on the second test of a class
   (SQLite in-memory savepoint quirk, diagnosed empirically) — setUp-level
   authentication uses Django's idiomatic `force_login`, while every real
   login flow (cookie flags, parity, throttle) is exercised end-to-end inside
   single tests in `AuthTests`/`ThrottleTests` and by the live HTTP smoke.
7. PowerShell `Set-Content -Encoding utf8` wrote UTF-8 BOMs into
   `forms.py`/`tests.py` (broke `ast.parse`) — stripped.

## 3. System check + migrate smoke (REAL, PASSED)

```powershell
..\..\.venv\Scripts\python.exe manage.py check      # System check identified no issues (0 silenced)
..\..\.venv\Scripts\python.exe manage.py makemigrations core
..\..\.venv\Scripts\python.exe manage.py migrate --no-input
# Applying contenttypes/auth/core/admin/sessions migrations ... OK (fresh sqlite db)
```

## 4. Live HTTP smoke (REAL, PASSED)

`runserver 127.0.0.1:8321 --noreload`, then:

```powershell
..\..\.venv\Scripts\python.exe smoke.py http://127.0.0.1:8321
```

Result: **32 passed, 0 failed** — real HTTP (cookie jars, real Set-Cookie
handling) covering: healthz envelope, X-Request-Id echo + invalid replacement,
register 201 + HttpOnly cookie, duplicate email 422 EMAIL_TAKEN, validation
422 with field details, login 200 + cookie flags, wrong password 401,
unknown-email parity, me/home, anonymous 401, note create/list/patch/get
delete, other-user's note 404, algorithm catalog/run/unknown/oversized/401,
logout → me 401 (server-side revocation), 5×401 → 6th attempt 429 +
Retry-After persisted, htmx failed login 422 partial fragment (no `<html>`),
non-htmx failed login 422 full page, web throttled login 429 + Retry-After
with the form visible.

Also live-checked: `/static/js/htmx.min.js` 200 (50,917 bytes),
`/static/js/alpine.min.js` 200 (44,758 bytes), `/static/css/tailwind.css` 200
(5,900 bytes, built), `/admin/login/` 200, and a real admin login walk
(CSRF-protected POST → 302, then `/admin/core/note/` changelist → 200 with a
logged-in superuser).

## 5. Tailwind build (REAL, PASSED)

```powershell
tailwindcss-windows-x64.exe (v3.4.17) -c tailwind.config.js -i static/css/input.css -o static/css/tailwind.css --minify
# Done in 720ms.  Output: 5,900 bytes (content-scanned from templates + py)
```

The compiled stylesheet is committed; the runtime never fetches a CDN.

## 6. Security review notes

- No secrets committed: `.env.example` carries non-reusable placeholders;
  `DJANGO_SECRET_KEY` required when `DJANGO_DEBUG=false` (fails fast);
  dev-only fallback key is clearly marked and only active with DEBUG=true.
- Passwords: Django's PBKDF2 (default hasher) via the custom manager +
  `set_password`; validators enforce ≥10 chars, non-common, non-numeric-only,
  non-email-similar. Passwords never logged or returned.
- Enumeration parity: unknown email vs wrong password → same code AND message
  (test-asserted); unknown email burns one hasher round for timing parity.
- Sessions: server-side rows (revocation on logout is real, test-asserted);
  HttpOnly + SameSite=Lax; Secure behind TLS via `SESSION_COOKIE_SECURE`;
  fixation-safe key rotation on login; ~30 min idle timeout.
- CSRF: framework middleware on every state-changing request; NO exemptions
  (register/login included); API clients echo `X-CSRFToken` from
  `GET /api/v1/csrf`; CSRF failure view returns the enveloped 403 on `/api/*`.
- Throttle: 5 failed logins / 60 s pinned window per email+IP; 429 +
  Retry-After on both surfaces; XFF ignored unless the peer is a trusted proxy
  (spoofed-XFF test asserts no bypass); success clears the tally; a block
  never outlives its window (expiry + prune are test-asserted).
- Workbench: fixed catalog, closed dispatch, no user-code path, 10,000-char
  bound (413), monotonic-clock duration reported separately from Big-O.
- Error surfaces: stable codes + safe messages; no stack traces/SQL/internals
  (DEBUG=False behavior is the production path; responses are envelope-shaped
  by construction).
- Logs: request bodies/credentials are never logged; envelope errors log only
  code/status/path.

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Browser e2e (Playwright) | not implemented | out of task scope; web behavior covered by HTTP-level tests + live smoke |
| Automated a11y audit | not implemented | out of scope (labels/roles hand-checked in templates; keyboard-reachable forms) |
| Production WSGI server (gunicorn/uwsgi) run | **UNVERIFIED** | task scope is the dev-server reference; settings fail-fast path (DEBUG=false) is code-reviewed but not exercised |
| PostgreSQL / other engines | intentionally not exercised | SQLite is the reference engine; `DATABASES` is the seam |
| Alpine.js runtime behavior in a real browser | **UNVERIFIED** | vendored file served 200; interactive Alpine behavior (workbench `x-data`) not exercised in a real browser |
| Multi-node throttle/session backends | intentionally out | in-process throttle + DB sessions are the documented single-node reference |
| docker-compose | intentionally none | single-process stack; compose adds nothing to this reference |

## 8. stack.json verification flags

- `manifest`: **true** — structure matches `schemas/stack-manifest.schema.json`
  rules (id pattern, maturity enum, verification booleans; CI validate-catalog
  re-checks against the catalog; local `validate_schemas.py` PASS).
- `unit`: **true** — 46 Django tests really ran green (`manage.py test`).
- `integration`: **true** — the suite is integration-grade (test-client HTTP
  through the full middleware stack incl. auth/throttle/CSRF) plus the real
  `runserver` HTTP smoke (32 checks).
- `e2e`: **false** — no automated browser e2e was run.
- `lastVerifiedAt`: 2026-10-25T00:30:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).

## 9. Paradigm contrast note (task ask)

Same server-rendered + htmx paradigm as Stack 04 (Go + Fiber), different
depth: Django supplies the ORM with real migrations and an auto-generated
admin (activated here as the paradigm showcase), declarative form validation
with accessible error rendering, and the complete session-auth machinery.
Stack 04 hand-rolls all of that; Stack 21 configures it. The htmx 4xx-swap
lesson (`htmx-config` responseHandling meta for 422/429) is applied and
pinned by a test so a regression fails CI.
