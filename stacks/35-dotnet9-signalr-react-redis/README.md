# Stack 35 — .NET / ASP.NET Core SignalR + React + Redis

Reference implementation for catalog entry
[35-dotnet9-signalr-react-redis](../../stacks/catalog.json) (`realtime` category).

- **Backend:** ASP.NET Core minimal API on .NET 10 (net10.0) — cookie auth
  (no ASP.NET Identity), PRD §7 envelope, bounded algorithm workbench, and an
  authorized SignalR hub at `/hubs/realtime` with per-user groups.
- **Frontend:** React 19 + Vite 7 SPA (port 5175) with the
  `@microsoft/signalr` client; live notification area fed by hub events.
- **Realtime substrate:** in-memory fan-out (verified). Redis backplane
  declared, not wired (see `verification.md` §5).

## Quick start

### 1. Backend

```powershell
cd backend
dotnet run --urls http://localhost:5080
```

Health check: `GET http://localhost:5080/healthz` →
`{"success":true,...}`.

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5175. The Vite dev server proxies `/api` and `/hubs`
(WebSocket) to `http://localhost:5080`, so cookies stay first-party.

### 3. Try the realtime path manually

1. Register/login at http://localhost:5175.
2. Keep the tab open on Home (live notification area is always mounted).
3. In the Algorithm screen, run an algorithm → a `run.completed` event is
   published and surfaces in the live area without refresh.

### 4. Tests

```powershell
# backend (from backend/tests)
dotnet test            # 37 tests

# frontend (from frontend/)
npm test               # vitest run, 17 tests
npm run build          # vite build
```

Full command log and evidence: `verification.md`.

## API overview (PRD §7 envelope everywhere)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | public | liveness |
| POST | `/api/v1/register` | public | create account (201 + envelope) |
| POST | /api/v1/login | public | cookie session; 429+Retry-After after 10 fails/60s |
| POST | `/api/v1/logout` | public | clears the session cookie |
| GET | `/api/v1/me` | cookie | current user |
| GET | `/api/v1/home` | cookie | demo metrics + server time |
| GET | `/api/v1/algorithm` | cookie | fixed catalog (4 algorithms) |
| POST | `/api/v1/algorithm/run` | cookie | run bounded algorithm; pushes `runEvent` via hub |
| WS | `/hubs/realtime` | cookie | SignalR hub (`runEvent`, `pong`); negotiate → 401 when anonymous |

## README sections (per docs/PRODUCT_REQUIREMENTS.md §6.4)

### 1. What this stack demonstrates

Realtime fan-out with per-user targeting: an authorized SignalR hub whose
group membership follows the session, REST→hub push through a dedicated
publisher interface (`IEventPublisher`), envelope-consistent REST, cookie
auth without Identity, and a safe bounded algorithm workbench (measured
duration vs Big-O displayed separately).

### 2. What is REAL vs scaffolded vs unverified

- **REAL (tested):** REST contract + auth + throttle + envelope; algorithm
  engine + bounds; hub auth (401 on anonymous negotiate), per-user groups,
  REST→hub `runEvent` push, `Ping`/`pong` — as real SignalR connections over
  TestServer in `dotnet test`; web unit tests + production build.
- **Scaffolded:** Redis backplane (package referenced, `AddStacksRedis` not
  wired); docker-compose (declarative only).
- **Section 5 (unverified):** Redis backplane run, docker-compose up, browser
  e2e — see `verification.md` §8 table.

### 6. Known limitations

- In-memory user store and throttle: single-node demo-grade; restart loses
  users; not multi-instance. Redis backplane alone would not fix the user
  store — that is a deliberate demo scope decision, documented in
  ARCHITECTURE.md §5.
- Browser-side SignalR session was not exercised end-to-end; the hub is
  verified via TestServer-based integration tests instead.
- No e2e suite; a11y is hand-checked (labels/roles), no automated audit.

### 6.bis Security posture

- PBKDF2-SHA256 (100k iterations, per-user salt) for credential hashing.
- No account enumeration: identical `INVALID_CREDENTIALS` for unknown email
  vs wrong password (test-asserted).
- Login throttle: 10 failures / 60 s pinned window per email+IP → 429 +
  `Retry-After`.
- Cookies: HttpOnly, SameSite=Lax, Secure same-as-request; 401/403 JSON
  instead of redirects.
- Hub is `[Authorize]`d with per-user groups; no cross-user fan-out.
- Algorithm input bounded (10,000 chars) and re-validated server-side; no
  user-code evaluation exists.
- `TreatWarningsAsErrors` incl. NU1902/NU1903 (vulnerable packages): MessagePack
  ≥ 2.5.307; SignalR.Client 10.0.13 in tests avoids vulnerable
  SignalR.Common ≤ 10.0.12 (GHSA-334f-vvp4-7g6p).

## docker-compose (unverified)

`docker-compose.yml` declares backend + Redis + frontend. **Never executed**
(no Docker daemon); the first real `docker compose up --build` is its
verification run. With Redis, also wire `AddStacksRedis` in `Program.cs`
(see ARCHITECTURE.md §5).

## License

MIT (repository-level).
