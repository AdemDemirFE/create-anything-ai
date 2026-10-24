# Stack 20 — FastAPI + React (Vite) + PWA

Reference implementation for catalog stack
`20-fastapi-react-vite-pwa` (category `classic-web`, maturity `scaffolded`).

A JSON API (FastAPI) with cookie-session auth and a fixed, bounded algorithm
workbench, plus a React 19 + Vite 7 single-page app shipped as a Progressive
Web App (installable manifest + service worker with a documented offline
strategy).

## Stack summary

| Layer | Technology | Version (tested) |
|---|---|---|
| Backend | Python + FastAPI | Python 3.13.2, FastAPI 0.129.0 |
| Web | React + Vite | React 19.2, Vite 7.3.7 |
| PWA | Web manifest + service worker | hand-rolled (no extra dependency) |
| Data | in-memory store | process-local (see ARCHITECTURE.md §3) |
| Tests | pytest / vitest | pytest 9.1.1 / vitest 4.1.12 |

## Repository envelope (frozen)

Every JSON response — success and error — uses the envelope from
`docs/PRODUCT_REQUIREMENTS.md` §7:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "timestamp": "2026-10-24T18:00:00.000Z",
    "request_id": "opaque-correlation-id"
  }
}
```

- `execution_ms` appears in `meta` only for `POST /api/v1/algorithm/run`,
  where it is actually measured (monotonic clock). It is never fabricated.
- Errors use the recommended shape: stable `code`, safe `message`, optional
  field-level `details` (validation). Stack traces are never returned.
- The correlation id is also returned in the `X-Request-Id` header.

## Endpoints

Base path `/api/v1`. Full contract in ARCHITECTURE.md §3.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/health` | public | liveness probe (envelope-less by convention) |
| POST | `/api/v1/register` | public | create account (201), 409 duplicate |
| POST | `/api/v1/login` | public | set HttpOnly session cookie; 429 when throttled |
| POST | `/api/v1/logout` | public | invalidate the session server-side |
| GET | `/api/v1/me` | session | current profile |
| GET | `/api/v1/home` | session | profile + sample metrics |
| GET | `/api/v1/algorithm` | session | fixed algorithm catalog |
| POST | `/api/v1/algorithm/run` | session | run one bounded fixed algorithm |

## Local setup (tested on Windows 11, Python 3.13.2 / Node 24)

### Backend

```powershell
cd stacks/20-fastapi-react-vite-pwa/backend

python -m venv .venv                      # create virtualenv once
.\.venv\Scripts\python.exe -m pip install -r requirements.txt   # pinned deps

.\.venv\Scripts\python.exe -m pytest      # 64 tests, unit + integration
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000   # run :8000
```

- `requirements.txt` is fully version-pinned; install into a venv (above),
  not the global interpreter.
- No database or external service is required (in-memory store). Data resets
  on restart — this is a documented reference-stack trade-off.

### Frontend

```powershell
cd stacks/20-fastapi-react-vite-pwa/frontend

npm install          # exit 0
npm test             # vitest: 19 tests
npm run build        # tsc --noEmit + vite build → dist/
npm run dev          # dev server :5173, proxies /api → :8000
npm run preview      # serve dist/ :4173, proxies /api → :8000
```

Run the backend on `:8000` first; both dev and preview proxy `/api` to it, so
session cookies stay first-party without extra CORS setup.

## PWA

- `public/manifest.webmanifest`: name, standalone display, theme/background
  colors, 192/512 (+maskable) icons. Linked from `index.html`.
- `public/sw.js`: service worker with the documented offline strategy:
  - **App shell + static assets:** cache-first with background refresh
    (stale-while-revalidate). The four screens remain usable offline.
  - **`/api/*`: network-only.** Session-backed data is never served from a
    cache; offline API calls fail and the UI shows its error states.
  - Non-GET requests are never intercepted. Old caches are purged on
    activate (`stack20-v1` cache name; bump the version to force refresh).
- `src/pwa.ts` registers the worker in production builds only (skipped in
  dev so Vite HMR is not shadowed by the precache).

Installability requires HTTPS or `localhost`. `npm run preview` on
`localhost:4173` is sufficient for local install testing.

## Environment variables (backend)

| Name | Purpose | Default |
|---|---|---|
| `SECURE_COOKIES` | set `1`/`true` when serving over TLS | empty (dev) |
| `ALLOWED_ORIGINS` | CORS allowlist override (comma-separated) | localhost:5173/4173 + 127.0.0.1:5173 |

`.env.example` documents these with non-reusable placeholders. **No secrets
are required or committed** — session tokens are generated per-process with
the OS CSPRNG and only SHA-256 digests are stored.

## Maturity

`scaffolded` — see `verification.md` for gate-by-gate evidence and the
`stack.json` verification flags (backend unit + integration and web unit +
build really ran; browser e2e and Docker were not exercised — see the
unverified table there).
