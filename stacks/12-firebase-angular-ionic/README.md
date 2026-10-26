# Stack 12 — Firebase / Angular / Ionic

BaaS reference stack: **Firebase Cloud Functions (Node 24) + Auth + Firestore**,
**Angular 19** web client with **Ionic 8** UI, and an **Ionic 8 + Capacitor 7**
mobile shell. The backend runs for real against the **Firebase Auth (9099) +
Firestore (8088) emulators**; no production Firebase project is required.

## Quick start (local, emulators only)

```bash
# 1. Functions + API tests (boots Auth + Firestore emulators; needs Java 11+)
npm --prefix functions install
npm --prefix functions run test:emulator     # real emulator suite

# 2. Web client
npm --prefix web install
npm --prefix web test                        # vitest + jsdom
npm --prefix web run build                   # production build

# 3. Interactive dev (optional)
npm run emulators                            # Auth + Firestore UI-less
npm --prefix functions run serve             # API on the Functions emulator
npm --prefix web run dev                     # Angular on :4200 (proxies /api/v1)
```

`.env.example` documents every knob (throttle, session TTL, CORS, ports) —
all have safe local defaults; nothing is required.

## Four-screen contract (PRD §6)

| Screen | Route | Backend |
|---|---|---|
| Register | `/register` | `POST /api/v1/auth/register` (normalize-before-unique, generic errors) |
| Login | `/login` | `POST /api/v1/auth/login` (throttled: 429 + Retry-After) |
| Home | `/home` | `GET /api/v1/home` (backend re-checks session; metrics + logout) |
| Workbench | `/algorithm`, `/documents` | `GET/POST /api/v1/algorithms[/:id/run]`, `CRUD /api/v1/documents` |

Wire envelope on every response: `{ ok, data, error, requestId }` with
`X-Request-Id` validated against `^[A-Za-z0-9-]{1,64}$` (invalid ids are never
echoed). See `ARCHITECTURE.md` §2 for the PRD §7 deviation note.

## Layout

```
functions/    Express app + Cloud Functions v2 wrapper + emulator test suite
web/          Angular 19 + Ionic 8 (standalone components) + vitest
mobile/       Capacitor 7 shell (config + docs only — UNVERIFIED, no SDK)
firestore.rules + firestore.indexes.json
firebase.json / .firebaserc / .env.example
```

## Verification status

See `verification.md` — functions emulator suite + web vitest/build are REAL
and green; production Firebase deploy and Android runtime are **UNVERIFIED**.
