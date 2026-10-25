# Stack 02 — verification evidence

Stack: `02-java25-springboot-angular-ionic` (Java 25 / Spring Boot 4.1,
Angular 20, Ionic 8 + Capacitor 7). Date: 2026-10-25. Environment:
Windows, JDK 25.0.2, Maven 3.9.15, Node 24.19.

## 1. VERIFIED — backend (`mvn test`)

Real JVM + real HTTP: `@SpringBootTest(RANDOM_PORT)` boots the full context
(Flyway + H2, `test` profile) and the tests hit
`http://127.0.0.1:<port>/api/v1/**` with `TestRestTemplate`.

Command (from `backend/`):

```bash
JAVA_HOME=<jdk-25> mvn -B test
```

Suites:

- `EnvelopeContractTest` — envelope shape on success AND error
  (`success/data/error/meta`), stable machine codes, `X-Request-Id` header
  present and matching `[A-Za-z0-9-]{1,64}`, incoming conforming id echoed
  in header AND body meta, over-long/non-conforming id replaced by a
  server-generated id, 401 envelope for unauthenticated `/home`.
- `AuthIntegrationTest` — register → login round trip echoing the
  NORMALIZED email; case/whitespace-variant email hits the SAME account
  (`EMAIL_TAKEN`, exactly one row — normalize-before-unique); identical
  envelope for unknown email vs wrong password (no enumeration); failed
  logins throttle at `app.throttle.login-max-failed-attempts` with HTTP 429
  `RATE_LIMITED` and `Retry-After` EQUAL TO THE CONFIGURED VALUE (test
  mutates the setting to 45 and asserts the header reads `45` — the header
  is config-driven, not a constant); successful login resets the tally;
  logout invalidates the session (home 200 → logout → 401).
- `AlgorithmEngineTest` — the four fixed algorithms (reverse, palindrome,
  fizzbuzz, wordcount): golden outputs, bounded-input rejection (blank,
  out-of-range, oversized with the 10 000 cap), measured-vs-theoretical
  separation.
- `HomeAndAlgorithmIntegrationTest` — authenticated home (screen 3) with
  profile + safe metrics; workbench catalog (screen 4) + run with
  `execution_ms` vs `complexity`; unknown algorithm → `UNKNOWN_ALGORITHM`;
  oversized input → `VALIDATION_ERROR` (bean validation).

Result: **exit 0 — 22 tests, 0 failures, 0 errors, 0 skipped.**
(Classes: AlgorithmEngineTest 8, AuthIntegrationTest 6, EnvelopeContractTest 5,
HomeAndAlgorithmIntegrationTest 3 — captured from the surefire summary,
`mvn test` with JDK 25.0.2, exit code 0.)

## 2. VERIFIED — web (vitest + production build)

Command (from `web/`):

```bash
npm install
npm test          # vitest run (jsdom, fetch mocked at the boundary)
npm run build     # ng build, production configuration
```

`web/src/web.client.test.ts` (12 tests, all passing):

- api client: envelope unwrapping + `lastRequestId` correlation tracking;
  non-2xx → `ApiError{code,status}`; non-JSON → synthesized `NETWORK_ERROR`;
  CSRF cookie echoed as `X-XSRF-TOKEN` on POST; calls hit the `/api/v1`
  prefix.
- register (screen 1) and login (screen 2): submit paths route to `/home`
  on success and map envelope errors to form feedback (including the 429
  `RATE_LIMITED` message rendered verbatim) without navigating.
- home (screen 3): loads profile + metrics and registers the documented 15 s
  polling timer (asserted via `setInterval` spy) — polling is the only
  update mechanism; there is no `EventSource`/WebSocket anywhere in the
  client. 401 surfaces the envelope message and drops to `/login`.
- algorithm workbench (screen 4): catalog load with complexity labels,
  POST to `/api/v1/algorithm?algorithm=<id>` with measured ms vs Big-O,
  oversized-input `INPUT_TOO_LARGE` error surfaced, no result on failure.

Production build: `ng build` exit 0 (AOT, budgets enforced, 298.58 kB
initial / 80.47 kB transfer).

> Test approach note: the page tests instantiate the components DIRECTLY
> (no Angular TestBed) — TestBed's JIT verifier is incompatible with
> vitest's ESM graph; template correctness is enforced by the AOT
> `ng build` gate (strictTemplates) in the same CI step.

## 3. UNVERIFIED — mobile shell (no mobile SDK)

`mobile/` (Ionic 8 + Capacitor 7) is IMPLEMENTED but NOT VERIFIED: the
reference environment has no Android SDK and no Xcode, so no Capacitor
project was ever created, synced, compiled or run. CI intentionally has no
mobile suite for this stack. Documented local verification path:
`mobile/README.md`.

## 4. UNVERIFIED — docker compose / PostgreSQL (no Docker daemon)

`docker-compose.yml` + `backend/Dockerfile` are DECLARATIVE ONLY: the Docker
daemon was not running in the implementation environment, so they have never
been executed. The verified databases are H2 (dev/test) in-process. The
PostgreSQL driver ships as a runtime dependency for the `prod` profile;
deploying it requires a real secret via `SPRING_DATASOURCE_*` env vars
(never committed).

## 5. UNVERIFIED — browser e2e

No end-to-end browser run was made against a live backend+frontend pair;
the web tests mock `fetch` at the boundary and the backend tests are
real-HTTP but headless. Listed honestly as not claimed (e2e=false in
`stack.json`).

## 6. Rules compliance (checked)

- Envelope + `X-Request-Id` regex `[A-Za-z0-9-]{1,64}`: enforced and tested
  (§1).
- Throttle 429 + `Retry-After` from config: enforced and tested (§1,
  mutated-config assertion).
- Test literals dictionary-style only: passwords/emails in all suites are
  word-based (`Harbor Lantern 42`, `river.orchard@example.com`); no
  leetspeak.
- Email normalize-before-unique: enforced in `AuthService.register` +
  `AppUserDetailsService.normalize` and tested (§1, case-variant conflict).
- SSE FORBIDDEN: no EventSource/WebSocket/SseEmitter anywhere; Home polls
  (§2).
- API/web separate prefixes: backend serves `/api/v1/**` only; the Angular
  app has its own origin/prefix (§1–§2).
- Four-screen contract: register, login, home, algorithm workbench all
  implemented and tested (backend §1: 22 tests; web §2: 12 tests + AOT
  build).
