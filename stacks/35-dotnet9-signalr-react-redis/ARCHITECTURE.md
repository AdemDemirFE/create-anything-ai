# Architecture — Stack 35 (.NET / ASP.NET Core SignalR + React + Redis)

## 1. Components

```
┌────────────────────────────┐         ┌──────────────────────────────────┐
│ React 19 + Vite SPA :5175  │  /api   │ ASP.NET Core minimal API :5080   │
│  - Auth / Home / Algorithm │ ──────► │  - /api/v1 (envelope contract)   │
│  - live notification area  │  /hubs  │  - cookie auth (custom store)    │
│  - @microsoft/signalr      │ ──────► │  - /hubs/realtime ([Authorize])  │
└────────────────────────────┘  (ws)   └──────────────┬───────────────────┘
                                       in-memory hub  │  declared, not wired:
                                       fan-out        ▼  SignalR.StackExchangeRedis
                                             ┌──────────────────┐
                                             │ Redis (backplane │
                                             │ substrate only)  │
                                             └──────────────────┘
```

- `backend/Program.cs` — composition root: auth, envelope middleware, REST
  endpoints, hub mapping.
- `backend/Auth/AuthTypes.cs` — `AuthConstants`, validation, PBKDF2
  `PasswordHasher`, in-memory `IUserStore`, `LoginThrottle`.
- `backend/Web/ApiEnvelope.cs` — PRD §7 envelope (`success`/`data`/`error`/
  `meta` with `timestamp`, `execution_ms`, `request_id`).
- `backend/Algorithm/AlgorithmCatalog.cs` — fixed catalog + runner (no eval).
- `backend/Realtime/RealtimeHub.cs` — authorized hub, `RunCoordinator`
  (`IEventPublisher` → hub groups), `RealtimeEvent`.
- `frontend/src/api/client.ts` — envelope-aware fetch client.
- `frontend/src/api/realtime.ts` — SignalR connection factory (cookie auth,
  automatic reconnect).

## 2. Request flow (algorithm run)

1. Browser POSTs `/api/v1/algorithm/run` with the session cookie.
2. Minimal API validates auth, dispatches to `AlgorithmRunner` (fixed
   catalog, bounded input, monotonic `Stopwatch` timing).
3. On success the handler publishes `RealtimeEvent("run.completed", …)` via
   `IEventPublisher`; `RunCoordinator` sends `runEvent` to group
   `user:{email}` through `IHubContext<RealtimeHub>`.
4. The SPA's open SignalR connection receives `runEvent` and surfaces it in
   the app-level live notification area — independent of the REST response.

## 3. Why a custom user store instead of ASP.NET Identity

Reference-app scope: the contract surface is one session cookie and four
REST endpoints. Identity would add UI scaffolding, EF Core, and a database
dependency that the stack deliberately does not have (no relational store in
this stack's data list — Redis is a realtime substrate, not a user DB).
`IUserStore` keeps the seam so a real store can replace the in-memory one.
Trade-off: single-node, demo-grade persistence (restart loses users).

## 4. CSRF / cookie decisions

`SameSite=Lax` + same-origin dev proxy (Vite proxies `/api` and `/hubs` with
`ws: true`) keep cookies first-party; there are no cross-site write paths in
the reference app, so no anti-forgery token is issued. `SecurePolicy.
SameAsRequest` keeps local HTTP testable while upgrading under HTTPS.
401/403 return envelope JSON instead of login redirects because the consumer
is an SPA, not a browser navigation (cookie `Events.OnRedirectTo*`
overridden).

## 5. Realtime scaling path (declared, not wired)

SignalR groups and the `IEventPublisher` seam are infrastructure-neutral.
To scale out: add Redis, call
`builder.Services.AddSignalR().AddStacksRedis(redisConnectionString)` in
`Program.cs`, and mount the backplane. The package is already referenced
(`Microsoft.AspNetCore.SignalR.StackExchangeRedis 10.0.1`); wiring was
intentionally left out because no Redis server was available to verify the
run (verification.md §5). The in-memory path is what the tests exercise.
Note the user store remains in-memory regardless — the backplane scales
hub fan-out only.

## 6. Test strategy

- **Backend xUnit (37):** REST integration over `WebApplicationFactory`
  (envelope shape with `SnakeCaseLower` naming, auth flows, throttle, error
  codes, `X-Request-Id`), algorithm-engine unit tests, and **real hub
  connections**: `Microsoft.AspNetCore.SignalR.Client` routed through
  `HttpMessageHandlerFactory` + a cookie-bridge `DelegatingHandler`, so
  negotiate/WebSocket genuinely flow through TestServer.
- **Frontend vitest (17):** client envelope handling, page behavior
  (Auth/Home/Algorithm), input cap, measured-ms vs Big-O separation.
- **Build gate:** `dotnet build` treats warnings as errors (incl. NU1902/
  NU1903); `vite build` must emit `dist/`.
