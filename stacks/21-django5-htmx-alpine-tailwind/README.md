# Stack 21 — Django 5 + htmx 2 + Alpine.js + Tailwind (built) reference implementation

Batteries-included, server-rendered paradigm: Django owns the ORM, migrations,
admin, forms, auth (sessions), and templates; htmx adds partial-response
interactivity; Alpine covers small client-side state; Tailwind ships as a
**pre-built, committed stylesheet** (no CDN at runtime).

This is the contrast stack to **Stack 04 (Go + Fiber + htmx)**: the paradigm is
the same (server-rendered + htmx partials), but here the framework supplies the
ORM depth, auto-generated admin CRUD, declarative form validation, and the
whole auth/session machinery that Stack 04 hand-rolls.

## Prerequisites

- Python 3.13 (tested on 3.13.2)

## Setup (clean checkout)

```powershell
cd stacks/21-django5-htmx-alpine-tailwind/django
python -m venv .venv
.venv\Scripts\python -m pip install "django>=5.2,<6.0"
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py runserver 127.0.0.1:8321
```

Copy `../.env.example` to `.env` and adjust before any non-local use
(`DJANGO_SECRET_KEY` is required when `DJANGO_DEBUG=false`).

## Run the tests

```powershell
.venv\Scripts\python manage.py test          # 46 tests (unit + integration)
.venv\Scripts\python manage.py check         # system check
# live HTTP smoke against a running server (see verification.md):
.venv\Scripts\python smoke.py http://127.0.0.1:8321
```

## The four screens

| Screen | URL | Notes |
|---|---|---|
| Register | `/register/` | Django form validation, password validators, htmx fragment on 422 |
| Login | `/login/` | Session cookie (HttpOnly, SameSite=Lax), throttle 429 + Retry-After |
| Home (protected) | `/home/` | Profile, sample metrics, Note CRUD via htmx partials |
| Algorithm workbench (protected) | `/algorithm/` | Fixed catalog, bounded input, measured duration vs Big-O |

## JSON API (`/api/v1`)

Session-cookie authenticated (same session as the web screens). Every response
uses the envelope `{ok, data, error, requestId}` (task contract; the deviation
from the PRD §7 default is documented in `../ARCHITECTURE.md`).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/csrf` | GET | Issue CSRF cookie; echo `X-CSRFToken` on state-changing calls |
| `/api/v1/register` | POST | Create account (201), EMAIL_TAKEN (422) |
| `/api/v1/login` | POST | Session login; 401 INVALID_CREDENTIALS; 429 THROTTLED + Retry-After |
| `/api/v1/logout` | POST | Server-side session revocation |
| `/api/v1/me` | GET | Authenticated profile |
| `/api/v1/home` | GET | Profile + metrics + notes |
| `/api/v1/notes` | GET/POST | List/create (owner-scoped) |
| `/api/v1/notes/{id}` | GET/PATCH/DELETE | Retrieve/update/delete (owner-scoped; 404 for others') |
| `/api/v1/algorithm` | GET | Fixed catalog |
| `/api/v1/algorithm/run` | POST | Bounded execution, no user code |

`X-Request-Id` is echoed when it matches `^[A-Za-z0-9-]{1,64}$`, otherwise a
fresh opaque 32-hex id is generated; the response always carries `X-Request-Id`.

## Admin (paradigm showcase bonus)

`/admin/` is activated with `Note` and the email-based `User` registered
(superuser: `python manage.py shell` → `create_superuser`). It demonstrates
the batteries-included contrast: auto-generated CRUD for the ORM models.

## Frontend assets — vendored/built, no CDN

- `static/js/htmx.min.js` — htmx 2.0.4 (vendored)
- `static/js/alpine.min.js` — Alpine.js 3.14.9 (vendored)
- `static/css/tailwind.css` — Tailwind 3.4.17 CLI build (committed; rebuild:
  `tailwindcss -c tailwind.config.js -i static/css/input.css -o static/css/tailwind.css --minify`)

See `../verification.md` for exactly what was verified and what was not.
