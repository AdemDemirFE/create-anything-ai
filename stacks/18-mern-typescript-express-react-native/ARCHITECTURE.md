# Architecture — Stack 18 MERN document-store

## 1. Why this stack looks the way it does

Stack 18 is Wave 4's **JS full-stack contrast** entry: same envelope-plus-
security discipline as the other reference stacks, but on a **document
store** (MongoDB) and a fully JavaScript/TypeScript toolchain
(Express + React + React Native). The defining extra surface is the
per-user **documents CRUD**.

## 2. Server

### 2.1 Mongoose posture — strict, allow-listed

- `mongoose.set('strict', true)` and `mongoose.set('strictQuery', true)`
  are set explicitly in `db.ts`: fields outside a schema can never be
  persisted, and query filters are schema-bound too.
- Every schema is a hard field allow-list (`User`: email + passwordHash;
  `Session`: tokenHash + userId + expiresAt; `Document`: userId + title +
  content + tags). Responses go through `toPublicUser` /
  `toPublicDocument` projections — `passwordHash`/`tokenHash` are
  structurally unreachable from any endpoint.
- Defense in depth: route handlers pick allow-listed fields from request
  bodies via `parseCredentials` / `parseDocumentInput` before any model
  sees them (tests assert injected fields like `isAdmin`, `userId`,
  `secret` are dropped end-to-end).
- Models are registered idempotently (`mongoose.models[name] ?? model(...)`)
  because the vitest suite re-evaluates the module per test file.

### 2.2 Sessions — cookie + Mongo + TTL

- Token: 32-byte CSPRNG hex; only its SHA-256 digest is stored.
- Cookie: `stack18_session`, HttpOnly, SameSite=Lax, Path=/, Secure when
  `SECURE_COOKIES` (TLS deployments only).
- Storage: `sessions` collection with a TTL index on `expiresAt`
  (`expireAfterSeconds: 0`) — MongoDB's background sweep reaps expired
  rows. Resolution additionally refuses expired rows on sight, so the
  TTL monitor's 60 s cadence cannot be exploited.
- Sliding idle expiry: every successful resolution re-anchors
  `expiresAt` to now + TTL (default 30 min).
- Fixation defense: a fresh token is minted on every login; logout
  deletes the row and clears the cookie (both test-asserted).

### 2.3 bcrypt off the event loop — worker_threads pool

bcrypt at 12 rounds costs 100–300 ms of pure CPU per call. `BcryptPool`
(`security/bcrypt-pool.ts`) keeps a bounded pool of `worker_threads`
Workers (default `min(4, availableParallelism - 1)`, env-tunable) and
dispatches `hash`/`compare` tasks with per-task id correlation and a FIFO
queue when all workers are busy.

Implementation notes:

- The worker source is an eval'd string that `require`s bcryptjs through
  an absolute path passed in `workerData` — no worker file on disk, so it
  behaves identically under vitest, tsx, and compiled `dist/` output.
- Unknown-email logins burn one `compare` against a throwaway hash
  (computed lazily at runtime, never committed) so response timing does
  not reveal account existence, matching Stack 20's enumeration defense.
- Crashed workers fail pending tasks and disable the pool (fail-closed).

### 2.4 Login throttle

Fixed window in-process, keyed `email + req.socket.remoteAddress`.
Counts only FAILED attempts; exceeding the window yields
**429 + `Retry-After`** (even with correct credentials); success clears
the tally. `X-Forwarded-For` is deliberately **not** honored — without a
trusted-proxy config any client could rotate identities to defeat the
limit (Stack-01 lesson). This is demo-grade single-instance throttling;
a production deployment would move it to Redis.

### 2.5 Envelope — the `{ok, data, error, requestId}` variant

The task contract for Stack 18 specifies the flat envelope
`{ ok, data, error, requestId }` (vs. the repository default
`{ success, data, error, meta.request_id }` in PRD §7). The PRD grants
per-API consistency ("define this consistently per API"); Stack 18 is
consistent in itself, and the shared client (`shared/src/envelope.ts`)
is the single normalizer for both clients, so the deviation is contained
to this stack. Error objects stay stable (`code`, safe `message`,
optional field-level `details`) and internals never leak (test-asserted).

### 2.6 X-Request-Id — validated, never echoed (Stack-20 lesson)

`requestIdMiddleware` accepts a client-supplied `X-Request-Id` only when
it matches `^[A-Za-z0-9-]{1,64}$`; anything else (too long, spaces,
separators — header-injection/log-forging vectors) is discarded and a
fresh opaque 32-hex id is generated. The validated/generated id lands in
both the `X-Request-Id` response header and `meta.requestId` (envelope).
Malformed JSON bodies are caught by a dedicated handler and returned as
400 `VALIDATION_ERROR` envelopes instead of falling into a generic 500.

## 3. Shared layer — one client, two platforms

`shared/src/` contains the entire client-side contract:

- `envelope.ts`: envelope types, `parseEnvelope` (strict shape
  validation), `normalizeEnvelope` (non-JSON/garbage → synthesized
  NETWORK_ERROR), `ApiError` carrying `code`/`status`/`requestId`/
  `details`.
- `api-client.ts`: transport-agnostic `ApiClient` — callers inject their
  `fetch` (browser global on web, React Native's fetch on Expo, mocks in
  tests). Payload bounds are enforced client-side before any network
  call, mirroring server bounds.

The React web app instantiates it with `/api/v1` (Vite dev/preview proxy
keeps everything same-origin, so the HttpOnly cookie just works). The
React Native wrapper instantiates it with an absolute base URL
(10.0.2.2 for Android emulators). The wrapper itself is **UNVERIFIED**
(no Expo SDK in this environment) — but the logic it depends on is fully
tested at the Node level.

## 4. Web client

React 18 + Vite 5 + TypeScript strict, react-router-dom 6. Four screens
per PRD §6 (Register, Login, Home, Algorithm workbench) plus the
Documents screen (list with pagination, create, delete). Client routing
guards are convenience only — every protected view relies on the
backend's 401, which the pages translate into a redirect to login.
Measured duration and theoretical Big-O are rendered as separate fields.

## 5. Testing strategy

- Server: vitest (single fork) + supertest + **mongodb-memory-server
  running a real mongod 7.0.14 in-process** — the persistence layer is
  exercised for real (TTL index, unique email index, ownership filters),
  not mocked. One mongod for the suite, one database per test file.
- Shared: vitest in plain Node — envelope normalization + client
  behavior with mocked transports. This suite doubles as the
  mobile-wrapper verification (per task contract).
- Web: vitest + jsdom + Testing Library — page-level behavior with the
  API client mocked at the module boundary.
- Builds: `tsc --noEmit` strict everywhere; server also compiles to
  `dist/` cleanly; web production build succeeds.

## 6. Known limitations

- In-process throttle/session TTL sweep are single-instance semantics.
- No CSRF token: state-changing routes are JSON-only with SameSite=Lax
  cookies and strict CORS allowlists — the same documented trade-off as
  Stacks 01/20/35 (cross-site form posts cannot produce JSON content
  types; Lax blocks cross-site cookie sends on non-GET navigations).
- No browser e2e (Playwright) and no mobile runtime verification in this
  task's scope; both are recorded in `verification.md` as gaps.
