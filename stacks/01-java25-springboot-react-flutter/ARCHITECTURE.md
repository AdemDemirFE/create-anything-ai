# Stack 01 Architecture — Java 25 / Spring Boot 4.1 + React + Flutter

## 1. Identity and maturity

- **ID:** `01-java25-springboot-react-flutter`
- **Name:** Java / Spring Boot + React + Flutter
- **Category:** `enterprise-cross-platform`
- **Maturity:** `scaffolded` (see verification.md for gate-by-gate evidence)
- **Owner:** TASK-005 reference implementation session
- **Last verified (UTC):** 2026-10-24
- **Supported OS (tested):** Windows 11 (backend + web). Mobile is untested (no Flutter SDK).
- **License notes:** Spring Boot (Apache-2.0), React (MIT), Flutter (BSD-3). No license conflicts.

## 2. Technology and compatibility matrix

| Component | Target version | Tested version | Support evidence | Notes |
|---|---|---|---|---|
| Language/runtime | Java 25 | 25.0.2 (Oracle JDK) | `mvn -version`, test run | Boot 4.1 supports Java 17–26 |
| Backend framework | Spring Boot 4.1.x | 4.1.2 | Maven Central + real `mvn test` | Spring Framework 7.0.10 |
| Web framework | React 19 + Vite 7 | see frontend-web/package.json + npm test/build | real `npm.cmd test`, `npm.cmd run build` | |
| Mobile framework | Flutter (stable) | NOT TESTED — no SDK in environment | none | code targets a documented contract |
| Database (tests/dev) | H2 | 2.3.232 (pinned) | real `mvn test` | 2.4.240 breaks Hibernate 7.4 validation + exceeds Flyway's verified range |
| Database (compose/prod) | PostgreSQL 16 | NOT RUN — Docker daemon unavailable | none | compose declared, marked unverified |
| Build tools | Maven 3.9.15 + wrapper 3.9.11 | 3.9.15 | real `mvn test` | wrapper pinned in `.mvn/wrapper/maven-wrapper.properties` |

Spring Boot 4 changes honored by this implementation: modular starters
(`spring-boot-starter-webmvc` instead of `spring-boot-starter-web`), Jackson 3
(`tools.jackson.*` packages), `TestRestTemplate` relocated to
`org.springframework.boot.resttestclient` in the `spring-boot-resttestclient`
artifact (needs `spring-boot-starter-restclient` on the test classpath).

## 3. Architecture

### Process boundaries

- One backend process (embedded Tomcat, port 8080). React SPA (dev server 5173,
  preview 4173) and the Flutter apps are separate processes/clients.
- Clients never touch the database; the REST API is the only trust boundary.

### Module layout

```text
backend/src/main/java/com/createanything/stack01/
├── Stack01Application.java     # entry point
├── algorithm/                  # fixed-catalog workbench (engine + controller)
├── auth/                       # User, UserRepository, AuthService, controllers
├── config/                     # SecurityConfig (auth decision lives here)
└── web/                        # API envelope + error handling + Home
backend/src/main/resources/
├── application.yml             # defaults + dev/test/prod profiles
└── db/migration/V1__init.sql   # Flyway schema
```

### API boundary and DTOs

All endpoints use the repository envelope from `docs/PRODUCT_REQUIREMENTS.md`
section 7 (`success` / `data` / `error` / `meta` with `timestamp`,
`execution_ms`, `request_id`), implemented once in `web/ApiResponse` and
enforced in tests (`EnvelopeContractTest`, integration assertions).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/register` | public | create account (201), 409 on duplicate |
| POST | `/api/v1/login` | public | create session cookie |
| POST | `/api/v1/logout` | public | invalidate server-side session |
| GET | `/api/v1/me` | session | current profile |
| GET | `/api/v1/home` | session | profile + sample metrics |
| GET | `/api/v1/algorithm` | session | fixed algorithm catalog |
| POST | `/api/v1/algorithm/run` | session | run one bounded fixed algorithm |
| GET | `/actuator/health` | public | liveness |

Error codes are stable strings: `VALIDATION_ERROR`, `EMAIL_TAKEN`,
`INVALID_CREDENTIALS`, `RATE_LIMITED`, `UNAUTHORIZED`, `FORBIDDEN`,
`UNKNOWN_ALGORITHM`, `INPUT_TOO_LARGE`, `NOT_FOUND`, `INTERNAL_ERROR`.
The correlation id is also returned in the `X-Request-Id` header.

### Persistence and migrations

- Flyway owns the schema (`V1__init.sql`: `users` table + unique email index).
- Hibernate runs `ddl-auto=validate`; migrations are the only DDL source.
- Dev/test use in-memory H2 (per-profile database name); compose uses
  PostgreSQL. Rollback = restore from backup + `flyway migrate`; no destructive
  automigrations are configured.

### Auth/session model (the documented auth decision)

- **Model: server-side sessions, not JWT.** Sessions are revocable server-side
  (`POST /api/v1/logout` invalidates immediately, verified by
  `logoutInvalidatesSession`), which a stateless JWT would need extra
  infrastructure to achieve. No refresh-token machinery is needed at this scope.
- **Cookie:** `STACK01_SESSION`, HttpOnly, SameSite=Lax, path `/`,
  30-minute idle timeout (`server.servlet.session.timeout`). Secure flag is set
  by the `prod` profile (behind TLS). Login rotates the session id (fixation
  defense).
- **Passwords:** BCrypt via Spring Security's `BCryptPasswordEncoder`; hashes
  are never returned by any endpoint; email is lowercased and unique at the
  persistence layer.
- **CSRF strategy (double-submit cookie, narrowed exemption):** the
  XSRF-TOKEN cookie must be echoed as X-XSRF-TOKEN on every state-changing API
  call EXCEPT `/api/v1/register` and `/api/v1/login`. Those two are exempt
  because they are pre-session endpoints: register has no session to ride a
  cross-site request with, and login-CSRF (forcing a victim to log into the
  attacker's account) is a low-impact risk for this reference app — the
  trade-off is deliberate and reviewed. The token cookie is re-issued on every
  request (`CsrfCookieFilter`), so the SPA/mobile client always has a current
  value. An authenticated caller missing the echo gets 403; an unauthenticated
  caller gets the clean 401 (both asserted by integration tests).
- **Rate limiting:** FAILED login attempts are throttled per email+client-IP
  (10 per 60s rolling window, in-process Caffeine cache, atomic
  `cache.asMap().compute`). Successes never count, and a successful login
  clears the tally for that identity pair. Exceeding the limit returns
  **HTTP 429** with a `Retry-After: 60` header. Keying on email+IP prevents a
  pure email-based denial-of-service against a victim. This is demo-grade and
  documented as such; production deployments should enforce limits at the
  edge/proxy.
- **CORS:** origins come from `app.cors.allowed-origins` (comma-separated;
  default `localhost:5173/4173`), overridable via the `ALLOWED_ORIGINS` env
  var — wired through `@Value`, so non-localhost deployments can enable CORS.
- **Demo mode:** `app.demo.enabled=true` (default false, dev only) returns a
  fixed demo payload from `/api/v1/home` **without** creating a session or
  bypassing authorization. It never substitutes real auth, and the `prod`
  profile pins it to `false`.
- **Enumeration defense:** unknown email and wrong password return the same
  code+message (`INVALID_CREDENTIALS`), asserted by a dedicated test.

### Local development services

- `docker-compose.yml` (stack root) declares PostgreSQL 16 + Redis 7 with
  healthchecks; only the backend port is published (5432/6379 stay inside the
  compose network). **Docker daemon was not running in the implementation
  environment — compose is declarative and unverified.**
- Default dev/test configuration needs no services at all (H2 in-memory).

### Production assumptions

- TLS termination in front of the app; `prod` profile requires
  `SPRING_DATASOURCE_URL/USERNAME/PASSWORD` from the environment and fails fast
  when missing; H2 console is not exposed; demo mode disabled.

## 4. Four-screen mapping

| Requirement | Implementation path/screen | Server-side protection | Tests |
|---|---|---|---|
| Register | web `RegisterPage` / mobile `RegisterScreen` | validation, BCrypt, unique email, 409 duplicate | `registerCreatesAccountAndReturnsEnvelope`, `registerRejectsInvalidEmail`, `registerRejectsWeakPassword`, `duplicateEmailIsRejectedWithoutLeakage` |
| Login | web `LoginPage` / mobile `LoginScreen` | rate limit, generic failure, session cookie | `loginSuccessAndProtectedHome`, `wrongPasswordGetsGenericError` |
| Home | web `HomePage` / mobile `HomeScreen` | backend session required; 401 otherwise | `loginSuccessAndProtectedHome`, `protectedEndpointsRejectUnauthenticatedRequests` |
| Algorithm workbench | web `AlgorithmPage` / mobile `AlgorithmScreen` | session required; fixed catalog; bounded input | `algorithmRunsFizzBuzz...`, `algorithmRejectsUnknownAlgorithmAndOversizedInput` |
| Logout/revocation | web navbar action / mobile settings action | server-side session invalidation | `logoutInvalidatesSession` |

## 5. Environment variables

| Name | Purpose | Required | Default | Secret | Consumer |
|---|---|---|---|---|---|
| `SPRING_PROFILES_ACTIVE` | select dev/test/prod | no | `dev` | no | backend |
| `SPRING_DATASOURCE_URL` | JDBC URL (prod) | yes in `prod` | profile default | no | backend |
| `SPRING_DATASOURCE_USERNAME` | DB user (prod) | yes in `prod` | profile default | no | backend |
| `SPRING_DATASOURCE_PASSWORD` | DB password (prod) | yes in `prod` | none — fails fast | **yes** | backend |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose DB bootstrap | no (compose only) | safe local placeholders | **yes** (user generates) | postgres |
| `REDIS_PASSWORD` | compose Redis auth | no (compose only) | generated locally | **yes** | redis |
| `ALLOWED_ORIGINS` | CORS override | no | localhost:5173/4173 | no | backend |

`.env.example` documents every variable with non-reusable placeholders; users
must generate real values locally.

## 6. Local setup (tested on Windows 11)

```powershell
# prerequisites: JDK 25, Node 24 (Flutter SDK NOT required to run backend/web)
java -version        # 25.0.2
node --version       # v24.x

# backend (mvnw wrapper, no global Maven needed)
cd stacks/01-java25-springboot-react-flutter/backend
.\mvnw.cmd test                      # 20/20 passing
.\mvnw.cmd spring-boot:run           # starts on :8080 (dev profile, H2)

# web
cd ../frontend-web
npm install
npm test                             # vitest
npm run build                        # production build
npm run dev                          # dev server on :5173
```

## 7. Database and migrations

- Schema owner: Flyway (`backend/src/main/resources/db/migration`).
- Migration tool runs automatically at startup before JPA validation.
- Local reset: restart the app (in-memory H2 is recreated) or
  `docker compose down -v` for the PostgreSQL deployment.
- Seed data: none. No demo accounts exist; registration creates real users.

## 8. Security

- Input validation: Jakarta Bean Validation + explicit service-level checks;
  oversized/malformed payloads rejected with stable codes.
- AuthN: BCrypt + server-side sessions (see §3).
- AuthZ: all non-public endpoints require an authenticated session;
  `anyRequest().denyAll()` closes everything else.
- CORS: explicit allowlist (localhost:5173/4173), credentials allowed, other
  origins rejected.
- Rate limits: login throttle 10/min/email (in-process, demo-grade).
- Uploads: multipart capped at 256KB (not used by the API).
- Secrets: none committed; `.env.example` uses placeholders; prod fails fast
  without DB credentials.
- Logging: passwords/tokens/cookies never logged; unexpected errors are logged
  server-side and returned as generic `INTERNAL_ERROR`.
- Dependency scanning: Gitleaks runs in CI (repository-level); per-stack
  Dependabot config is out of TASK-005 scope.

## 9. Testing and acceptance

- Unit tests: `AlgorithmEngineTest` (7), `EnvelopeContractTest` (3) — real runs.
- Integration tests: `ApiIntegrationTest` (10) over a real HTTP server + H2.
- API contract tests: envelope shape asserted in unit + integration tests.
- UI/e2e: not automated in this task (web component tests only); documented gap.
- Accessibility checks: web screens use labeled inputs/roles; no automated a11y
  audit — documented gap.
- Dependency/security scans: repository CI (Gitleaks, validate-catalog).
- Smoke tests: manual `spring-boot:run` startup + health endpoint.
- Clean-room setup: `mvn test` runs from a fresh clone (wrapper downloads
  Maven); npm install from package-lock.
- Known untested areas: Flutter (no SDK), Docker Compose (no daemon),
  PostgreSQL path (compose only), browser e2e.

## 10. Operational readiness

- Health: `GET /actuator/health` (public, details hidden).
- Logs: structured console logs; no request bodies logged.
- Graceful shutdown: default Spring Boot behavior (SIGTERM).
- Backup/restore: out of scope for reference maturity (compose volumes are
  named; restore = volume restore + `flyway migrate`).
- Metrics: actuator `health,info` only; full observability is a follow-up.

## 11. Agent task plan (implemented by TASK-005)

| Task | Scope | Status |
|---|---|---|
| TASK-005a | backend API + auth + tests | done (20/20 real) |
| TASK-005b | web 4 screens + vitest + build | done (real runs) |
| TASK-005c | Flutter screens per contract | code only — unverified |
| TASK-005d | compose/.env/verification | done (compose unverified) |
