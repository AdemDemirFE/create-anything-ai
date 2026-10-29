# AI Agent Setup — Stack 01

Instructions for AI agents working in `stacks/01-java25-springboot-react-flutter/`.

## Ground truth before writing code

1. Read `stacks/01-java25-springboot-react-flutter/ARCHITECTURE.md` — the API
   boundary, auth decision (server-side sessions), CSRF strategy, and
   verification status are documented there and are binding.
2. Read `docs/PRODUCT_REQUIREMENTS.md` section 6 (four-screen contract) and
   section 7 (API envelope). Every JSON response MUST use that envelope.
3. Read `docs/QUALITY_GATES.md`. Never claim a gate you did not observe.

## Environment facts (as of 2026-10-24)

- Java 25.0.2 + Maven 3.9.15 available; `mvnw` wrapper is pinned to 3.9.11.
- Node 24 available. **Flutter SDK NOT available** — mobile code is written to
  the documented contract but CANNOT be run, analyzed, or tested. Never write
  "tested" for anything Flutter.
- Docker CLI exists but the daemon may not be running; compose is declarative.
- Spring Boot 4 note: starters are modularized — use `spring-boot-starter-webmvc`
  (not `-web`), and Jackson 3 packages (`tools.jackson.*`). `TestRestTemplate`
  lives in `org.springframework.boot.resttestclient`.

## API contract (frozen for this stack)

Base path `/api/v1`, repository envelope on every response:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": { "timestamp": "...", "execution_ms": 2.4, "request_id": "opaque" }
}
```

Endpoints: `POST /register`, `POST /login`, `POST /logout`, `GET /me`,
`GET /home`, `GET /algorithm`, `POST /algorithm/run`, `GET /actuator/health`.
Session cookie: `STACK01_SESSION` (HttpOnly, SameSite=Lax). Error codes are the
stable strings listed in ARCHITECTURE.md §3. Changing the contract requires
updating backend, web, mobile, and the tests together.

## Rules for agents

- Backend changes must keep `mvnw.cmd test` green (20 tests). Run it; report the
  real result.
- Web changes must keep `npm test` and `npm run build` green. Run them.
- Mobile changes: update `frontend-mobile/lib/` screens + `pubspec.yaml` only;
  record in `verification.md` that they remain unverified.
- Never execute user-supplied code in the algorithm workbench. Only the fixed
  catalog in `AlgorithmCatalog` is runnable. Input is capped at
  `AlgorithmEngine.MAX_INPUT_LENGTH` (10,000 chars).
- Never commit secrets. `.env.example` carries placeholders only.
- Do not bump the pinned H2 2.3.232 without re-running the full test suite —
  Hibernate 7.4 schema validation currently fails against H2 2.4.240
  (see ARCHITECTURE.md compatibility matrix).

## Verification workflow

1. Make the change in one layer (or contract-coherent layers).
2. `cd backend && .\mvnw.cmd test` (Windows) or `./mvnw test`.
3. `cd ../frontend-web && npm test && npm run build`.
4. Update `verification.md` with exact commands + outcomes; update
   `stack.json` verification flags only for layers you actually ran.
5. Report changed files, commands, and known gaps — never invented results.
