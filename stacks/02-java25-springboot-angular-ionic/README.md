# Stack 02 - Java 25 / Spring Boot + Angular + Ionic

Reference stack: one Spring Boot API (`/api/v1`, envelope contract), an
Angular 20 web client and an Ionic 8 + Capacitor 7 mobile shell implementing
the four-screen contract (register / login / home / algorithm workbench).

| Layer  | Path      | Status |
|--------|-----------|--------|
| API    | `backend/`| VERIFIED (`mvn test`, real HTTP + H2) |
| Web    | `web/`    | VERIFIED (vitest + `ng build`) |
| Mobile | `mobile/` | UNVERIFIED (no Android SDK / Xcode) |

Key contracts (details in `ARCHITECTURE.md`, evidence in `verification.md`):

- Envelope `{success, data, error, meta}` on every response; `X-Request-Id`
  header matching `[A-Za-z0-9-]{1,64}` (conforming incoming ids echoed).
- Login throttle: HTTP 429 + `Retry-After`, fully config-driven
  (`app.throttle.*`).
- Email normalize-before-unique (trim + lowercase before every check/insert).
- Polling ONLY - SSE/WebSocket are forbidden in this stack.
- API and web on separate prefixes.

## Quick start

```bash
# backend (JDK 25)
cd backend && mvn spring-boot:run     # dev profile: H2 in-memory

# web
cd web && npm install && npm start    # http://localhost:4200
```
