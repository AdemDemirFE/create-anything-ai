# Stack 21 — Architecture decisions

## 1. Paradigm: batteries-included, server-rendered (the Stack-04 contrast)

Django 5.2 (LTS) supplies, out of the box, what Stack 04 (Go + Fiber + htmx)
hand-rolls: ORM + migrations, the auto-generated admin, declarative form
validation with accessible error rendering, the whole auth/session machinery
(password hashing, session store, fixation-safe login), and CSRF middleware.
htmx 2 provides the same partial-response UX as Stack 04; Alpine 3 covers the
tiny client-side state (workbench selection); Tailwind is compiled ahead of
time and committed — the runtime never touches a CDN.

## 2. Auth model — Django sessions (HttpOnly cookie), not JWT

- `core.models.User` replaces `username` with a unique `email`
  (`AUTH_USER_MODEL` swapped before the first migrate, with a matching
  `UserManager` so `create_user` needs no positional username).
- Sessions live in `django_session` (DB-backed), so **logout is a real
  server-side revocation**: `django_logout` deletes the row; the cookie value
  dies with it (test-asserted).
- Cookie: `stack21_session`, `HttpOnly`, `SameSite=Lax`, `Secure` behind TLS
  via `SESSION_COOKIE_SECURE`. `SESSION_SAVE_EVERY_REQUEST=True` gives an
  **idle timeout** (~30 min default): Django re-anchors expiry on every
  request, so an unused session expires even though login happened hours ago.
- `django_login` rotates the session key on every login (fixation-safe).

## 3. CSRF strategy

Standard Django CSRF middleware on every state-changing request — there are
no exemptions (register/login included). The web forms embed
`{% csrf_token %}`; htmx requests echo the token via an `X-CSRFToken` header
added in a `htmx:configRequest` listener. JSON API clients fetch the token
from `GET /api/v1/csrf` (also sets the cookie) and echo it. CSRF failures
render a plain error page on the web and the enveloped 403 on
`/api/*`. SameSite=Lax plus same-origin-only deployment makes this the
framework-native choice; no custom CORS surface exists in this reference.

## 4. Envelope — `{ok, data, error, requestId}` (task contract)

The task explicitly names the `{ok,data,error,requestId}` envelope (same shape
as Stack 08's normalized envelope). The PRD §7 default is
`{success,data,error,meta}`; **the task contract wins** and the deviation is
recorded here and in verification.md. Rules kept from the PRD: `data` is null
on errors; `error` is a stable object (`code` + safe `message` + optional
field-level `details`); no stack traces, SQL, or internals ever reach the
client; `requestId` correlates with the `X-Request-Id` response header.

## 5. Failed-login throttle — in-process, no third-party app

`core.throttle.LoginThrottle`: thread-safe dict of buckets keyed
`email+client-IP`; pinned 60 s window; only FAILED attempts count; a success
clears the tally. With limit N: attempts 1..N answer 401, attempt N+1 answers
**429 + Retry-After** (both API and web; the web form stays visible — the
`htmx-config` meta is what makes htmx swap that 429 body, the Stack-04
lesson). A block never outlives its window: `check()` resets an expired
bucket and expired buckets are pruned opportunistically (bounded memory, no
lockout until process restart). Client IP resolution honors `X-Forwarded-For` only when the direct
peer is in `TRUSTED_PROXIES` (default empty ⇒ XFF ignored entirely; spoofed
XFF cannot rotate identities — test-asserted). Demo-grade by design: in-process,
single-node. The seam for multi-node is the throttle class itself (swap the
dict for Redis).

## 6. htmx contract (Stack-04 lesson applied)

htmx 2 does **not** swap 4xx bodies by default, and this design's error
contract depends on swapping (422 form re-render, 429 throttle notice). Every
page therefore declares:

```html
<meta name="htmx-config" content='{"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"422","swap":true},{"code":"429","swap":true},{"code":"[45]..","swap":false,"error":true}]}'>
```

Protected-page behavior mirrors Stack 04: anonymous full-page GET → 302 to
`/login/?flash=login-required`; anonymous htmx request → **401 + HX-Redirect**
(a 302 would make htmx swap the login page into the fragment target).

## 7. Algorithm workbench safety

Fixed five-algorithm catalog (`fizzbuzz`, `palindrome`, `fibonacci`,
`reverse`, `wordcount`), closed dict dispatch, no `eval`/`exec` path, input
bounded at 10,000 chars (413 `INPUT_TOO_LARGE`), per-algorithm integer ranges
(fibonacci ≤ 90, fizzbuzz ≤ 500). Measured duration comes from
`time.perf_counter()` (monotonic) and is rendered **separately** from the
static Big-O string.

## 8. Data model

SQLite for the reference (Django ORM is the paradigm point; the engine is
swappable via `DATABASES`). Two models: the custom `User` and `Note`
(owner FK, 120-char title, 2000-char body, owner+created_at index). Note
queries are always owner-scoped; another user's note is a **404, not a 403**
(no existence oracle). Uniqueness of email lives at the persistence layer
(unique index) with a raced-registration `IntegrityError` path mapped to
`EMAIL_TAKEN`.

## 9. Secrets & configuration

`DJANGO_SECRET_KEY` comes from the environment; DEBUG mode falls back to a
clearly-marked dev-only key, production (DEBUG=false) fails fast without it.
`.env` is gitignored; `.env.example` carries non-reusable placeholders.
Nothing in the request path is logged except the stable error code + path.
