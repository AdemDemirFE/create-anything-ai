# Stack 05 — NestJS 11 + TypeORM + Next.js 15 + React Native (Expo)

Enterprise cross-platform reference stack: one NestJS 11 API (TypeORM on a
pluggable SQL driver), a Next.js 15 App Router web client and a React Native
(Expo) shell — all three clients import ONE shared API-client layer.

## Status: scaffolded (verification matrix at the bottom)

| Part | Implemented | Verified |
| --- | --- | --- |
| Server (NestJS 11 + TypeORM) | yes | vitest + supertest on a REAL better-sqlite3 in-memory DB (54 tests) + real-HTTP smoke (32 checks) |
| Shared layer (envelope + ApiClient) | yes | vitest (12 tests) |
| Web (Next.js 15 App Router) | yes | `next build` production build + vitest screen tests (8 tests) |
| Mobile (React Native / Expo shell) | yes (authored) | **UNVERIFIED at runtime** — no iOS/Android SDK in this workspace; typecheck-only |

## Layout

```
stacks/05-nestjs-typeorm-nextjs-reactnative/
├── server/    NestJS 11 API (TypeORM + better-sqlite3 driver)
├── web/       Next.js 15 App Router client (four screens)
├── shared/    envelope contract + transport-agnostic ApiClient
├── mobile/    React Native (Expo) shell (UNVERIFIED at runtime)
└── scripts/   real-HTTP smoke (scripts/smoke.mjs)
```

## Contract highlights (enforced by tests)

- **Envelope**: every response is `{ ok: boolean, data: T | null, error: { code, message, details? } | null }`; errors carry STABLE machine codes
  (`VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `UNAUTHORIZED`, `NOT_FOUND`, `INPUT_TOO_LARGE`, `UNKNOWN_ALGORITHM`, `RATE_LIMITED`, `INTERNAL`).
- **Correlation**: every response carries `X-Request-Id` matching `[A-Za-z0-9-]{1,64}`. Inbound ids are honored only when contract-shaped; malformed
  ones are replaced (never echoed).
- **Throttle**: login failures are rate-limited per (normalized email, peer IP)
  with a config-driven fixed window; exhausted identities get `429` +
  `Retry-After` (seconds), computed from `LOGIN_THROTTLE_RETRY_AFTER_SECONDS`.
  Correct credentials reset the counter. The throttle runs BEFORE password
  verification (locked identities never touch scrypt).
- **Email normalization**: email is normalized (trim + lowercase) at the DTO
  transform stage — BEFORE validation and before the uniqueness check. The
  uniqueness is a database UNIQUE index over `email_normalized`, so a race
  between concurrent registers still collapses into one account.
- **Sessions**: opaque 32-byte tokens (CSPRNG) in an HttpOnly, SameSite=Lax
  cookie; the database stores only SHA-256 digests; logout deletes the row.
- **Algorithm workbench**: fixed 4-entry catalog; user input is DATA (source
  scan test pins: no dynamic evaluation or process-execution primitives in
  the engine). The engine is the SINGLE SOURCE OF TRUTH for the input bound:
  `ALGORITHM_MAX_INPUT` is clamp-tighten-only (never above
  `ABSOLUTE_MAX_INPUT_LENGTH` = 100_000; invalid values fall back to 10_000),
  and `/api/v1/algorithm` advertises the engine's effective bound.
- **Bounded payloads**: the shared client refuses to serialize oversized
  inputs before the network; the server re-checks with class-validator and
  the engine.
- **Safe errors**: the global exception filter renders every failure as the
  envelope with a stable code and a safe message — no stack traces, SQL text
  or paths cross the boundary (test-pinned).

## Data model (TypeORM entities)

- `users`: `email` (display), `email_normalized` (UNIQUE), `password_hash`
  (scrypt N=2^15 r=8 p=1 + 16-byte random salt, hashed in bounded
  worker threads with `maxmem` raised), `created_at`.
- `sessions`: `token_hash` (UNIQUE), `user_id`, `expires_at`, `created_at`.
- `documents`: `user_id`, `title`, `content`, `tags_json`,
  `created_at`, `updated_at` (+ index for newest-first pagination).

## Four-screen journey (docs/PRODUCT_REQUIREMENTS.md §6)

1. **Register** (`/register`): email + password -> 201 + session cookie.
2. **Login** (`/login`): envelope errors incl. 429 RATE_LIMITED with
   Retry-After.
3. **Home** (`/home`): authenticated profile + safe sample metrics
   (document count, session model, uptime).
4. **Algorithm workbench** (`/algorithm`): fixed catalog + run with measured
   duration displayed separately from the static complexity note.

The React Native shell exposes the same four screens over the same shared
ApiClient (tabs in one screen, Expo-idiomatic).

## Running locally

```bash
# server (terminal 1)
cd stacks/05-nestjs-typeorm-nextjs-reactnative/server
npm install
npm run build && npm start            # listens on http://localhost:4000/api/v1

# web (terminal 2)
cd ../web
npm install
npm run dev                           # http://localhost:3000 (proxies /api/v1)
```

## Tests

```bash
cd server && npm test        # 54 tests, REAL better-sqlite3 in-memory DB
cd shared && npm test        # 12 tests (client contract)
cd web && npm test           # 8 tests (four screens, mocked ApiClient)
node scripts/smoke.mjs       # against a RUNNING server (SMOKE_BASE_URL)
```

## Production notes (explicitly out of scope for the reference)

- Swap the TypeORM driver from `better-sqlite3` to PostgreSQL 17 + migrations
  (`synchronize: false`); the entity layer is driver-agnostic.
- Back the login throttle with Redis (single-process Map here).
- Serve the web build behind the same reverse proxy as the API (cookie is
  SameSite=Lax; cross-site deployments need CSRF hardening).
- The RN shell needs `EXPO_PUBLIC_API_BASE` pointing at a reachable host.
