# Stack 36 — Go / gorilla/websocket + Vue 3

Reference implementation for catalog entry
[36-go-gorilla-websockets-vue3](../../stacks/catalog.json) (`realtime`
category) — the **çırak-WS** counterpart to Stack 35: the same realtime
problem, solved with a hand-rolled hub on gorilla/websocket instead of
SignalR/Redis abstractions.

- **Backend:** Go 1.27 `net/http` + **gorilla/websocket v1.5.3** — cookie
  session auth, PRD §7 envelope, bounded algorithm workbench, and a `/ws`
  endpoint whose hub (register/unregister/broadcast, per-client buffered
  send, slow-client drop, write deadlines, ping/pong, origin check) is
  written BY HAND in `backend/internal/ws`.
- **Frontend:** Vue 3 + Vite 7 SPA (port 5173) with a RAW `WebSocket` client
  (`src/api/realtime.ts`, hand-written backoff reconnect) and an always-on
  live event panel fed by hub broadcasts.
- **Realtime substrate:** in-process hub, single-node by design (see
  ARCHITECTURE.md §7 for the scale-out seam).

## Quick start

### 1. Backend

```powershell
cd backend
go run ./cmd/backend            # listens on :8080 (PORT env overrides)
```

Health check: `GET http://localhost:8080/healthz` → `{"status":"ok"}`.

### 2. Web

```powershell
cd web
npm install
npm run dev                     # http://localhost:5173 (proxies /api and /ws)
```

Open http://localhost:5173, register, keep two tabs open, run an algorithm in
one → the `run.completed` broadcast appears in BOTH tabs' live panels without
refresh.

### 3. Live smoke test (real server, two WS clients)

```powershell
# shell 1
cd backend; $env:PORT='18080'; go run ./cmd/backend
# shell 2
cd backend; go run ./cmd/smoke
```

The smoke walks register→login→home→run over HTTP, opens TWO real WebSocket
clients with independent sessions, asserts anonymous `/ws` → 401, triggers a
REST run and asserts both clients receive `run.completed`, then checks the
app-level ping→pong. Exit 0 = passed.

### 4. Tests

```powershell
# backend (from backend/)
go test ./... -count=1          # 36 tests (16 app integration + 20 ws)
go vet ./...
gofmt -l .                      # empty output

# web (from web/)
npm test                        # vitest run, 18 tests
npx vue-tsc --noEmit            # type check
npm run build                   # vite build → dist/
```

Full command log and evidence: `verification.md`.

## API overview (PRD §7 envelope everywhere)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | public | liveness |
| POST | `/api/v1/register` | public | create account (201 + envelope) |
| POST | `/api/v1/login` | public | cookie session; 429+Retry-After after 10 fails/60s |
| POST | `/api/v1/logout` | public | invalidates the session server-side |
| GET | `/api/v1/me` | cookie | current user |
| GET | `/api/v1/home` | cookie | demo metrics + server time |
| GET | `/api/v1/algorithm` | cookie | fixed catalog (4 algorithms) |
| POST | `/api/v1/algorithm/run` | cookie | run bounded algorithm; broadcasts `run.completed` |
| WS | `/ws` | cookie | upgrade (401 anonymous, 403 foreign origin) into the hand-rolled hub |

WS frames: server → `run.completed` (type/email/algorithm_id/execution_ms/
complexity/occurred_at) and `pong`; client → `{"type":"ping"}` only.

## What this stack demonstrates

Writing a realtime fan-out from scratch: the gorilla single-reader/
single-writer pattern, a serialized hub loop, per-client backpressure with a
documented slow-client drop policy, deadline-based keepalive, and upgrade-time
auth + origin checks — every piece test-pinned, none provided by a framework.

## README sections (per docs/PRODUCT_REQUIREMENTS.md §6.4)

### What is REAL vs scaffolded vs unverified

- **REAL (tested):** REST contract + auth + throttle + envelope + request-id;
  hub membership/broadcast/drop; upgrade handshake (401/403/101), two-client
  broadcast, REST→hub push, keepalive — as real gorilla connections over
  httptest (`go test`), plus the live two-client smoke on a running server;
  web unit tests + type check + production build.
- **Scaffolded:** docker-compose (see below); nothing else is declarative —
  every runtime behavior in scope is implemented and tested.
- **Unverified:** `go test -race` (no C compiler on the verification box),
  docker-compose up (daemon unavailable), browser e2e — see
  `verification.md` §8.

### Known limitations

- In-memory user store, in-process hub/throttle: single-node, demo-grade;
  restart loses users (deliberate; seams documented in ARCHITECTURE.md §7).
- No e2e suite; a11y is hand-checked (labels/roles), no automated audit.
- Reconnect backoff is fixed-exponential (1s→8s cap), no jitter.

### Security posture

- bcrypt password hashing (default cost); hashes never leave the store.
- No account enumeration: identical `INVALID_CREDENTIALS` for unknown email
  vs wrong password (test-asserted).
- Login throttle: 10 failures / 60 s pinned window per email+IP → 429 +
  `Retry-After`; XFF ignored unless a trusted proxy is configured
  (spoofed-XFF no-bypass test-asserted).
- Cookies: HttpOnly, SameSite=Lax, `Secure` via env behind TLS; 401/403
  return envelope JSON.
- `/ws`: session required before upgrade; **CrossOriginWSRF** origin
  allowlist (cookies ride along on cross-site WS handshakes — SameSite does
  not protect the handshake); foreign origin → 403 pre-upgrade.
- Algorithm workbench: fixed catalog only, no user-code evaluation path;
  input bounded at 10,000 chars; bodies capped at 256KB (413).
- WS inbound frames are type-checked and never echoed; `run.completed`
  payloads are server-generated only.
- Logs: no request bodies, passwords, cookies, or authorization headers.

## docker-compose (unverified)

`docker-compose.yml` declares the backend service (in-memory store — no
database in this stack's reference scope). **Never executed** (no Docker
daemon available during verification); the first real
`docker compose up --build` is its verification run.

## License

MIT (repository-level).
