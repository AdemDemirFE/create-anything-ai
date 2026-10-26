# Stack 05 verification evidence

Every claim below is tied to a command that was actually run in this
workspace on 2026-10-25 (Node 24 / npm 11.17 / Windows). No claim is made
without the matching command and result.

## Scope rule

- VERIFIED = the command ran here and its output is summarized below.
- UNVERIFIED = authored but NOT executed (the reason is stated).

## 1. Server — NestJS 11 + TypeORM (VERIFIED)

Command (from `stacks/05-nestjs-typeorm-nextjs-reactnative/server`):

```
npm run typecheck        # tsc --noEmit -p .      -> exit 0
npm test                 # vitest run             -> exit 0
```

Result: **6 test files, 54 tests, all passing (~12–23 s wall time).**
Runner: vitest 2.1.9 + supertest over the real Nest HTTP stack
(`NestFactory.create` -> `app.getHttpServer()`), database: a REAL
better-sqlite3 **in-memory** SQLite per suite (no mocks at the DB layer).

Coverage by file:

| File | What it pins |
| --- | --- |
| `tests/envelope.test.ts` | `{ ok, data, error }` on success AND error paths; `X-Request-Id` shape `[A-Za-z0-9-]{1,64}`; inbound malformed ids replaced (not echoed); 404 unknown routes still envelope-shaped; 400 VALIDATION_ERROR with details; 401 UNAUTHORIZED; no stack traces/paths in error bodies; unique ids per request |
| `tests/auth.test.ts` | register 201 + HttpOnly SameSite=Lax cookie; invalid email 400; weak password 400; duplicate 409 EMAIL_TAKEN; **mixed-case + padded email collapses to the same account (normalize BEFORE unique)**; login with uppercased email works; wrong-password vs unknown-email = identical 401 INVALID_CREDENTIALS shape (anti-enumeration); logout revokes (subsequent /home 401) |
| `tests/documents.test.ts` | create/list/get/patch/delete; newest-first + pagination metadata; **LIKE wildcards in the USER search term are literals** (`50% off` matches `50% off`, not `50 percent alternative`); per-user scoping (other user's doc = 404); oversized title/content 400 (never truncated); unknown id 404 |
| `tests/throttle.test.ts` | unit (injected clock): lock at maxFailures, expiry after window, (email, IP) isolation, success clears history, case-insensitive keying — **including the maxFailures=1 locks-on-first-failure edge**; integration: 5 failures -> 429 RATE_LIMITED + Retry-After 1..60, correct password after partial failures resets history, throttle never touches authenticated endpoints |
| `tests/algorithm.test.ts` | fixed 4-entry catalog + engine-bound advertised by GET /algorithm; **engine = single source of truth (tightened config shows up in catalog AND run enforcement); tighten-only clamp** (over-absolute/0/negative/NaN fall back, lower values honored); reverse + multibyte code-point safety; palindrome; word-count; fizzbuzz bounds; unknown id 400 UNKNOWN_ALGORITHM; 10_000 at-cap accepted / 10_001 -> 400 INPUT_TOO_LARGE with the bound in the message; **source scan: no dynamic evaluation or process-execution primitives in the engine** |
| `tests/home.test.ts` | authenticated profile + metrics; document count reflected in metrics; 401 without session; 401 with revoked session |

Build proof: `npm run build` (tsc -p tsconfig.build.json) exits 0.

## 2. Shared layer (VERIFIED)

Command (from `shared/`): `npm run build` (tsc --noEmit) -> exit 0;
`npm test` -> **12/12 passing**.

Pins: envelope normalization hardening (non-envelope shapes -> UNKNOWN,
missing data/error coerced to null), error mapping to `ApiError`
(code/message/details/status), request-id header shape enforcement, JSON
body building, query-string building, **client-side bound rejection before
any network call** (oversized `runAlgorithm` input rejects with
INPUT_TOO_LARGE and never invokes fetch).

## 3. Web — Next.js 15 App Router (VERIFIED)

Commands (from `web/`):

```
npm run build            # next build (production) -> exit 0
npm test                 # vitest run              -> exit 0
```

Result:

- `next build` compiles + typechecks + prerenders all routes:
  `/`, `/register`, `/login`, `/home`, `/algorithm`, `/_not-found`
  (static prerender, First Load JS ~105 kB).
- **8/8 screen tests pass** (vitest + Testing Library + jsdom, ApiClient
  mocked): register success routes home / surfaces EMAIL_TAKEN; login
  success / friendly RATE_LIMITED message; home loads metrics + logs out /
  401 redirects to /login; algorithm loads catalog + runs + shows measured
  duration / surfaces INPUT_TOO_LARGE.

## 4. Real-HTTP smoke (VERIFIED)

Commands (from repo root):

```
# server built with npm run build, then:
node <server>/dist/boot.js          # PORT=4121
SMOKE_BASE_URL=http://127.0.0.1:4121/api/v1 node stacks/05-nestjs-typeorm-nextjs-reactnative/scripts/smoke.mjs
```

Result: **32/32 checks pass, exit 0.** Journey exercised over REAL HTTP:
public catalog -> register (201 + HttpOnly cookie) -> home (email +
metrics) -> algorithm run (reverse + multibyte + measured ms) -> unknown id
(400 UNKNOWN_ALGORITHM) -> 5 login failures then 429 RATE_LIMITED with
`Retry-After: 1..60` -> unauthenticated home (401 envelope) -> logout ->
revoked session (401). Every check also asserts the envelope contract and
the `X-Request-Id` shape on the response.

## 5. React Native shell (UNVERIFIED at runtime)

Authored: `mobile/App.tsx` (four-screen journey over the shared ApiClient),
`mobile/index.ts`, `mobile/app.json`, `mobile/tsconfig.json`, README.

Reason NOT verified: this workspace has no iOS/Android SDK, emulator or
Expo runtime; `npm install` of `expo`/`react-native` was not run here. The
shell is typecheck-authored only. This is disclosed in `stack.json`
(maturity stays `scaffolded`, `e2e: false`) and in `mobile/README.md`.

## 6. Production deployment (UNVERIFIED, out of scope)

No deploy was performed. Production notes (PostgreSQL driver swap, Redis
throttle backing, TLS/secure cookies) are documented in README.md as
explicitly out of scope for the reference.

## Secret hygiene

All literals in tests are plain dictionary words (e.g. `Correct-Horse-9x`,
`smoke-runner-...@example.com`); no real credentials or high-entropy
strings are committed.
