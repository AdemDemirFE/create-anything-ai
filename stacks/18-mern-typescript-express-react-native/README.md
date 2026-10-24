# Stack 18 — MERN (TypeScript) Document-Store Reference

Classic-web contrast stack: **MongoDB + Express 4 + React 18 + React Native (Expo)**,
TypeScript end to end, built around a **document store** (per-user documents CRUD)
with the repository's four-screen contract.

## Layout

```
server/    Express 4 + Mongoose 8 API (TypeScript, strict)
shared/    Shared API client + envelope normalization (web AND mobile)
web/       React 18 + Vite four-screen client (+ documents screen)
mobile/    React Native (Expo) thin wrapper — UNVERIFIED, see its README
```

## Quick start (local)

```bash
# 1. Server (needs a local MongoDB, or point MONGODB_URI anywhere sane)
cd server
npm install
cp ../.env.example ../.env        # optional: all defaults are dev-safe
npm test                          # real in-process mongod, no external DB needed
npm run build
npm start                         # listens on :4000

# 2. Web
cd ../web
npm install
npm test
npm run dev                       # proxies /api -> localhost:4000
```

## Contract summary

- Envelope on every JSON response: `{ ok, data, error, requestId }`
  (task-specified flat variant of the PRD §7 convention; rationale in
  `../ARCHITECTURE.md`). `requestId` is the validated `X-Request-Id`
  (`^[A-Za-z0-9-]{1,64}$`) or a fresh opaque id — never echoed unvalidated.
- Sessions: HttpOnly `SameSite=Lax` cookie, server-side rows in MongoDB
  (TTL index), SHA-256 digests only, sliding 30-minute idle expiry,
  fresh token per login, logout invalidates server-side.
- Passwords: bcrypt (bcryptjs 12 rounds) executed inside a bounded
  `worker_threads` pool — never on the event loop.
- Login throttle: fixed window, keyed email + TCP peer IP, counts only
  failures, 429 + `Retry-After`, success clears the tally, XFF ignored.
- Documents CRUD: ownership-scoped, allow-listed fields
  (`title` ≤ 200, `content` ≤ 10 000, ≤ 10 tags of ≤ 32 chars),
  stable 404 for foreign/missing ids, 400 `INVALID_ID` for malformed ones.
- Algorithm workbench: fixed 5-entry catalog, input bounded at 10 000
  chars, measured duration reported separately from theoretical Big-O.

## Endpoints (`/api/v1`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | trivial probe, intentionally envelope-less |
| POST | `/register` | — | 201 / 400 / 409 |
| POST | `/login` | — | 429 + Retry-After when throttled |
| POST | `/logout` | — | idempotent |
| GET | `/home` | cookie | profile + metrics |
| GET | `/algorithm` | cookie | fixed catalog |
| POST | `/algorithm/run` | cookie | bounded input |
| POST | `/documents` | cookie | create |
| GET | `/documents` | cookie | paginated list (page/limit) |
| GET | `/documents/:id` | cookie | read |
| PUT | `/documents/:id` | cookie | partial update |
| DELETE | `/documents/:id` | cookie | delete |

## Status

- `server/` — verified (vitest + supertest + mongodb-memory-server, 60 tests).
- `shared/` — verified (vitest, 15 tests) — this is also the mobile wrapper logic.
- `web/` — verified (vitest + jsdom, 19 tests; production build green).
- `mobile/` — **UNVERIFIED** (no Expo SDK); code-only wrapper, see `mobile/README.md`.

See `verification.md` for exact commands, results, and known gaps.
