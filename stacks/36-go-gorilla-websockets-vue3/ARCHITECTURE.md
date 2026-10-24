# Architecture — Stack 36 (Go / gorilla/websocket + Vue 3)

## 1. Paradigm: the çırak-WS contrast with Stack 35

Stack 35 solves the same realtime problem with ASP.NET Core SignalR + a Redis
backplane abstraction: the framework owns the protocol negotiation, group
membership, reconnection, and backpressure. Stack 36 solves the SAME problem
with the opposite philosophy — **nothing is provided**. gorilla/websocket
supplies only the RFC 6455 upgrade and frame codec; everything above it is
written by hand in this repo:

| Concern | Stack 35 (SignalR) | Stack 36 (hand-rolled) |
|---|---|---|
| Protocol | negotiate + MessagePack/JSON, framework-managed | raw JSON text frames over one socket |
| Membership | `Groups.Add("user:{email}")` | `Hub` map + register/unregister channels |
| Fan-out | `IHubContext.Clients.Group(...)` | `Hub.Broadcast` snapshot walk |
| Backpressure | framework send buffers | per-client buffered channel + **slow-client drop policy** |
| Keepalive | server timeout knobs | hand-written ping/pong with `PongWait`/`WriteWait` deadlines |
| Client lib | `@microsoft/signalr` | native `WebSocket` + hand-written reconnect/backoff |
| Scale-out | Redis backplane (declared) | out of scope — the seam is `RunPublisher` |

## 2. Components

```
┌────────────────────────────┐          ┌───────────────────────────────────────┐
│ Vue 3 + Vite SPA :5173     │   /api   │ Go net/http :8080 (Go 1.27)           │
│  - AuthView (login/regist) │ ───────► │  - /api/v1 (PRD §7 envelope)          │
│  - HomeView (+LivePanel)   │          │  - cookie session auth (custom store) │
│  - AlgorithmView(+panel)   │   /ws    │  - /ws: gorilla Upgrader              │
│  - RealtimeClient (raw WS) │ ───────► │    └─ hand-rolled Hub                 │
└────────────────────────────┘   (ws)   │       register/unregister/broadcast   │
                                        │       slow-client drop, ping/pong     │
                                        └───────────────────────────────────────┘
```

- `backend/cmd/backend` — entry point (env config only).
- `backend/cmd/smoke` — live smoke: 4-screen REST walk + two real WS clients.
- `backend/internal/envelope` — PRD §7 envelope on net/http; `meta.request_id`
  and the `X-Request-Id` header carry the SAME id (validated inbound).
- `backend/internal/{store,auth,throttle,clientip,validation,algorithm}` —
  the same reviewed designs as Stack 04 (bcrypt, enumeration parity, pinned
  window failed-login throttle with XFF ignored, fixed safe catalog).
- `backend/internal/ws` — the hand-written hub (see §3).
- `backend/internal/api/ws.go` — upgrade endpoint + `HubBroadcaster`
  (the `RunPublisher` seam, mirroring Stack 35's `IEventPublisher`).
- `web/src/api/realtime.ts` — raw `WebSocket` client, hand-written exponential
  backoff reconnect (1s→2s→4s→8s cap).
- `web/src/components/LivePanel.vue` — always-mounted live event surface.

## 3. The hand-rolled hub (internal/ws)

Concurrency model (gorilla's chat pattern, made explicit and test-pinned):

- **Single-writer per conn.** `readPump` is the only reader; `writePump` is
  the only writer (gorilla requires this; concurrent writes panic/interleave).
- **Hub loop.** `Run()` serializes membership transitions (register/
  unregister) and processes broadcasts one at a time. `Count()` reads a
  snapshot under an RWMutex (the one pragmatic concession over a pure
  channel-owned map — it keeps tests/metrics race-free).
- **Per-client buffered send.** `Client.Send` (capacity `SendBuffer`, default
  16). The hub enqueues non-blocking; the writer goroutine drains.
- **Slow-client drop policy.** If `SendMsg` finds the buffer full during a
  broadcast, the hub closes the client's channel (`CloseOnce`) and removes it
  from membership — it never blocks the hub on one stalled consumer and never
  buffers unboundedly. The dropped writer sends a close frame and exits.
- **Write deadline.** Every conn write carries `WriteWait` (default 10s); a
  TCP-stalled peer fails the write instead of leaking the goroutine — the
  deadline half of the same policy.
- **Keepalive.** `writePump` pings every `PingPeriod` (30s); `readPump`
  extends the read deadline by `PongWait` (45s) on every PONG. A silent peer
  is dropped after `PongWait`. An APPLICATION-level `{"type":"ping"}` →
  `{"type":"pong"}` mirrors this for JS clients (protocol frames are not
  observable from the browser API).

## 4. /ws upgrade order

1. `RequireSession` middleware: no/expired cookie → **401 envelope** before
   any upgrade (gorilla has no auth concept; the cookie IS the credential).
2. Origin check (**CrossOriginWSRF**): browser cookies ride along on
   cross-site WS handshakes (SameSite does not save you here), so
   `Upgrader.CheckOrigin` delegates to an allowlist (`WS_ORIGINS` env; dev
   default `http://localhost:5173`). Foreign origin → **403 before upgrade**.
3. gorilla `Upgrader.Upgrade` performs the RFC 6455 handshake.
4. `ws.ServeClient` registers the client and starts both pumps.

## 5. Auth decision (session cookie, not JWT)

Documented decision, mirroring Stack 01/04 and deliberately NOT JWT: the only
client is a same-origin Vue SPA behind the Vite proxy in dev; sessions are
revocable server-side (logout deletes the record), HttpOnly + SameSite=Lax,
`Secure` via `COOKIE_SECURE=true` behind TLS. JWT would add token storage and
refresh questions the four screens do not have. The WS upgrade authenticates
with the same cookie. bcrypt runs synchronously on the request goroutine —
in Go there is no event loop to block; the cost motivates throttling failed
logins BEFORE hashing (10 / 60s pinned window per email+IP → 429 +
`Retry-After`, XFF ignored by default).

## 6. Test strategy

- **Hub unit (14 in `internal/ws`):** register/unregister counts, broadcast
  delivery, fan-out to two clients, no delivery after unregister, slow-client
  drop with buffer recovery, closed-client send, empty-hub no-op, config
  ordering; connection-level pumps over a real gorilla dialer + httptest
  (broadcast over the wire, app ping→pong, silent-peer drop after PongWait,
  stalled-writer teardown, close-frame teardown).
- **App integration (16 in `internal/app`):** the exact production wiring via
  `httptest.Server`: envelope shape (201/409/400 field-level/401 parity),
  protected 401s, full register→login→home→run→logout walk with measured
  `execution_ms`, algorithm error codes, throttle 429 + Retry-After + correct
  login stays 429 + spoofed-XFF no-bypass, X-Request-Id honored/replaced and
  equal to `meta.request_id`, 256KB body cap 413; /ws: 401 anonymous, 403
  foreign origin, upgrade + broadcast to two cookie-authenticated clients,
  REST→hub `run.completed` push, app ping→pong.
- **Web vitest (18):** envelope client (success/error/network synthesis/JSON
  body), raw WS client (status transitions, event parse, backoff reconnect,
  disconnect suppression, app ping), four-screen components (login navigate,
  field-level alerts, home metrics + logout, 401 redirect, algorithm
  measured-vs-Big-O separation, client-side 10k cap).
- **Live smoke (`cmd/smoke`):** real server on :18080 — health, register,
  login, home, TWO real WS upgrades (own sessions), anonymous 401, REST run →
  both clients receive `run.completed`, app ping→pong.

## 7. Known limitations

- In-memory user store + in-process hub/throttle: single-node, demo-grade;
  restart loses users. Scale-out seam: `RunPublisher` (replace with a
  Redis/NATS-backed broadcaster) + external session store. Deliberate scope,
  mirroring Stack 35's decision.
- No browser e2e (Playwright) and no automated a11y audit; labels/roles are
  hand-checked and component tests assert the visible contract.
- The race detector (`go test -race`) could not run on this Windows box (no C
  compiler for cgo); Linux CI is expected to run it — see verification.md §8.
