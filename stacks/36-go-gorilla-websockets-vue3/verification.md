# Verification — Stack 36 (TASK: gorilla/websocket + Vue 3 reference)

**Verified at (local):** 2026-10-25, 02:00–03:00 UTC+3 (session window
2026-10-24 late evening → 2026-10-25 early morning)
**Branch:** `feat/stack-36-go-gorilla-websockets-vue3`
**Scope rule:** every claim below is tied to a command that actually ran in
this session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Go | 1.27.0 (windows/amd64) | `go version` |
| Node.js | v24.19.0 | `node --version` |
| npm | 11.17.0 | `npm.cmd --version` |
| Vite / Vitest | 7.3.7 / 4.1.12 | `npm run build` banner / `npm test` header |
| gorilla/websocket | v1.5.3 | `go.mod` + `go mod tidy` download log |
| Docker | CLI present (daemon processes visible) but **compose NOT exercised** — see §6 | `Get-Process com.docker.backend` |

esbuild note (same as Stack 35): the local `allow-scripts` policy holds
esbuild's postinstall script; the binary itself runs (`npx esbuild --version
→ 0.28.2`), so `vitest run` and `vite build` are unaffected (exit 0).

## 2. Backend — `go test ./... -count=1` (REAL, PASSED)

Commands (exact, from `stacks/36-go-gorilla-websockets-vue3/backend`):

```powershell
go build ./...        # exit 0
go vet ./...          # exit 0, clean
gofmt -l .            # empty output (no formatting diffs)
go test ./... -count=1  # exit 0
```

Results: **30 tests pass** — 16 app integration + 14 ws (hub unit + pump).

```text
ok  .../internal/app   2.634s  (16 tests)
ok  .../internal/ws    0.963s  (14 tests)
```

### internal/ws — hand-rolled hub + pumps (14)

Hub unit (real goroutine + channels, channel-synced, no sleeps):

- `TestRegisterIncrementsCount`, `TestUnregisterDecrementsCount`
- `TestBroadcastReachesRegisteredClient`, `TestBroadcastFanOutTwoClients`
- `TestUnregisteredClientDoesNotReceiveBroadcast`
- **`TestSlowClientIsDroppedOnFullBuffer`** — buffer size 2, client stops
  reading, third broadcast overflows → client is unregistered, its send
  channel closes after the queued frames drain, and the hub keeps serving a
  fresh client afterwards (the drop policy end-to-end)
- `TestSendMsgAfterCloseReturnsFalse`, `TestBroadcastOnEmptyHubIsNoop`,
  `TestDefaultConfigOrdering` (PingPeriod < PongWait)

Connection-level (gorilla dialer ↔ httptest server through the REAL
`ServeClient` wiring):

- `TestClientReceivesBroadcastOverRealConnection`
- `TestAppLevelPingGetsPong`
- `TestSilentClientIsDroppedAfterPongWait` — PongWait read-deadline drop
- `TestStalledWriterEventuallyFailsDeadline` — stalled TCP peer + full
  buffer → drop path tears the connection down
- `TestCloseFrameEndsRegistration` — polite close unregisters

### internal/app — production wiring over httptest.Server (16)

- REST envelope: `TestHealthz`, `TestRegister201EnvelopeShape` (201 +
  `meta.request_id` == `X-Request-Id`), `TestDuplicateEmail409`
  (EMAIL_TAKEN), `TestValidationErrorsFieldLevel` (email+password details),
  `TestLoginEnumerationParity` (unknown email ≡ wrong password: same
  status/code/message), `TestProtectedEndpointsRequireAuth` (4 endpoints ×
  401 UNAUTHORIZED), `TestFullWalkRegisterLoginHomeRunLogout` (register →
  login → me → home → catalog → run with measured `execution_ms` → logout →
  401), `TestAlgorithmErrors` (UNKNOWN_ALGORITHM 400, INPUT_TOO_LARGE 413),
  `TestOversizedBody413` (256KB cap)
- Throttle: `TestLoginThrottle429WithRetryAfter` (429 + `Retry-After`
  header, correct login stays 429, spoofed XFF does NOT mint a fresh bucket)
- Correlation: `TestRequestIDHonoredAndInvalidRejected` (valid inbound id
  echoed verbatim in header AND meta; short id replaced)
- WS upgrade: `TestWSUpgradeRequiresSession` (anonymous → 401 envelope),
  `TestWSOriginCheckRejectsForeignOrigin` (allowed origin → 101; `evil` →
  403 BEFORE upgrade), `TestWSBroadcastReachesBothClients` (two
  cookie-authenticated upgrades, one broadcast, both receive),
  `TestAlgorithmRunPublishesWSEvent` (REST run → `run.completed` with
  email/algorithm_id/execution_ms over the wire), `TestWSAppLevelPingPong`

## 3. Web — `npm test` + type check + build (REAL, PASSED)

Commands (exact, from `stacks/36-go-gorilla-websockets-vue3/web`):

```powershell
npm.cmd install        # 0 vulnerabilities
npx.cmd esbuild --version  # 0.28.2 (postinstall held by allow-scripts; binary works)
npm.cmd test           # vitest run
npx.cmd vue-tsc --noEmit
npm.cmd run build
```

Results:

```text
npm.cmd test           → Test Files 3 passed (3), Tests 18 passed (18), EXIT 0
npx.cmd vue-tsc --noEmit → EXIT 0 (no type errors)
npm.cmd run build      → vite v7.3.7: ✓ 37 modules transformed, dist/ emitted, EXIT 0
```

Coverage: API client envelope handling (success/error/network synthesis/
non-JSON body/POST content-type); raw WS `RealtimeClient` (connect URL +
status transitions, event parse with malformed-frame tolerance, backoff
reconnect after unexpected close, disconnect suppression, app ping frame);
Auth view (login navigate, field-level alerts, generic credentials banner);
Home view (email + metrics render, logout call, 401 → auth redirect);
Algorithm view (catalog render, run output, **measured duration vs
theoretical Big-O as separate labeled fields**, client-side 10,000-char cap
rejected before any API call).

## 4. Live smoke — real server, two WS clients (REAL, PASSED)

Commands (exact):

```powershell
# shell 1
cd stacks/36-go-gorilla-websockets-vue3/backend
$env:PORT='18080'; go run ./cmd/backend

# shell 2
cd stacks/36-go-gorilla-websockets-vue3/backend
go run ./cmd/smoke
```

Observed (full output):

```text
ok   GET /healthz → 200
ok   POST /api/v1/register → 201 (got 201)
ok   X-Request-Id header present
ok   meta.request_id == X-Request-Id
ok   POST /api/v1/login → 200 (got 200)
ok   GET /api/v1/home → 200 (got 200)
ok   home data carries the session email
ok   two WS clients upgraded (101) with allowed Origin
ok   anonymous /ws → 401
ok   POST /api/v1/algorithm/run → 200 (got 200)
ok   both WS clients received run.completed(fizzbuzz)
ok   events carry the runner's email
ok   app-level ping → pong

SMOKE PASSED: envelope + request-id + four-screen REST + 2-client WS broadcast all green.
```

(The server process was then stopped. Two unrelated `com.docker.backend`
processes were running on the box; no containers were started or touched.)

## 5. Issues found and fixed during real runs (all resolved, suite green)

1. **Hub self-send deadlock:** the Run loop originally unregistered slow
   clients by sending on its own `unregister` channel — Run was inside the
   broadcast case, nobody read the channel → guaranteed deadlock on the
   first drop (caught by `TestSlowClientIsDroppedOnFullBuffer`). Fixed: Run
   closes + removes slow clients INLINE (idempotent `CloseOnce` + direct map
   update); external `Unregister` still uses the channel.
2. **Buffered-close semantics:** closing a buffered channel does not discard
   queued values; the drop test now drains queued frames before asserting
   the channel is closed.
3. **gorilla dialer has no cookie jar:** WS upgrade tests must attach the
   session cookie header manually (httptest client's jar is not consulted);
   the anonymous 401 test correctly predates login.
4. **`http.Client` refuses control characters in headers:** the invalid
   X-Request-Id test uses a short id (server rule 8..128) instead of `x\ny`.
5. Frontend: `RealtimeClient.connect` guard syntax; `disconnect` now clears
   `onclose` before closing so a deliberate close cannot schedule a
   reconnect (caught by the mock-WS reconnect test); reconnect test drives
   `close()` (which fires `onclose`) instead of calling the handler bare.

## 6. Docker Compose (NOT RUN — unverified)

`docker-compose.yml` declares the backend service (in-memory store — no
database in this stack's scope). **`docker compose build` / `up` were NOT
executed in this session**; the compose path is declarative and marked
unverified in `stack.json`'s scope via this file. The first real
`docker compose up --build` is its verification run.

## 7. Security review notes

- No secrets committed: the stack needs none (in-memory store; no `.env`
  required; compose carries no credentials).
- Envelope errors never include stack traces or internals (stable codes +
  safe messages).
- Passwords: bcrypt (golang.org/x/crypto v0.58.0, default cost), hashed
  synchronously on the request goroutine (no event loop in Go — the task's
  "off-loop" concern maps to: cost bounded + throttling BEFORE hashing);
  never logged or returned; enumeration parity is test-asserted.
- Sessions: 256-bit crypto/rand opaque ids, 30-minute TTL, server-side
  revocation on logout (test-asserted); cookie HttpOnly + SameSite=Lax,
  `Secure` via `COOKIE_SECURE=true` behind TLS. Auth model: **session
  cookie, not JWT** — decision documented in auth.go + ARCHITECTURE.md §5.
- Login throttle: 10 failed attempts / 60s pinned window per email+IP,
  in-process, demo-grade and documented; 429 + Retry-After; XFF ignored by
  default (spoofed-XFF no-bypass test-asserted; correct login stays 429).
- **CrossOriginWSRF:** WS handshakes are not protected by SameSite cookies
  (browsers attach first-party cookies to cross-site WS connects), so the
  upgrade requires a session AND an allowlisted Origin (`WS_ORIGINS`; dev
  default `http://localhost:5173`) — foreign origin 403 BEFORE the RFC 6455
  handshake (test-asserted); anonymous upgrade 401 (test-asserted).
- WS input handling: inbound frames are parsed as `{"type":"..."}` only;
  malformed frames are ignored; nothing user-supplied is ever echoed or
  broadcast (server-generated payloads only).
- Algorithm workbench: fixed catalog, closed-switch dispatch, no code-input
  path; input bounded at 10,000 chars; request bodies capped at 256KB (413).
- X-Request-Id: inbound ids validated (printable ASCII, 8..128) before echo
  — header-injection safe (test-asserted).
- Logs: no request bodies, passwords, cookies, or authorization headers.

## 8. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| `go test -race` | **UNVERIFIED** | `-race` requires cgo + a C compiler; this Windows box has none (`CGO_ENABLED=1` → "gcc not found"). The concurrency design is exercised by the real goroutine/channel tests above; Linux CI should run the race build as its first verification. |
| Browser e2e (Playwright) | not implemented | out of scope; WS path covered by real dialer tests + live smoke; web behavior by component tests |
| Browser WS session (manual) | partially verified | the exact upgrade+broadcast+pong flow ran via the Go smoke client; a human clicking through the Vite dev server is the remaining manual step (recipe in README §3.2) |
| docker compose up | **UNVERIFIED** | not exercised this session |
| Automated a11y audit | not implemented | out of scope (labels/roles hand-checked in components) |
| Persistent database | intentionally none | documented in-memory decision (ARCHITECTURE.md §7); `store.Store` is the seam |
| Horizontal scaling | intentionally out | in-process hub/sessions/throttle; `RunPublisher` is the seam (ARCHITECTURE.md §1) |

## 9. stack.json verification flags

- `manifest`: **true** — structure matches `schemas/stack-manifest.schema.json`
  (id pattern, maturity enum `scaffolded`, verification block); CI
  validate-catalog re-checks against the catalog (also updated to
  `scaffolded`).
- `unit`: **true** — 14 ws tests (hub + pumps) really ran green.
- `integration`: **true** — 16 httptest integration tests over the exact
  production wiring (REST + WS upgrade paths) really ran green; live smoke
  passed against a real server.
- `e2e`: **false** — no automated browser e2e was run.
- `lastVerifiedAt`: 2026-10-24T23:30:00Z (UTC timestamp of the green runs).
- `evidencePath`: `verification.md` (this file).
