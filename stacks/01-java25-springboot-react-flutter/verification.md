# Verification — Stack 01 (TASK-005)

**Verified at (local):** 2026-10-24, 19:47–19:52 UTC+3
**Branch:** `feat/stack01-java25-springboot-react-flutter`
**Scope rule:** every claim below is tied to a command that actually ran in this
session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Java (runtime for tests) | 25.0.2 (Oracle JDK, build 25.0.2+10-LTS-69) | `java -version` |
| Maven | 3.9.15 + repo wrapper pinned to 3.9.11 (`only-script`) | `mvn -version`, `.mvn/wrapper/maven-wrapper.properties` |
| Node.js | v24.19.0 | `node --version` |
| Docker | CLI 29.1.3 present; **daemon NOT running** (`docker info` → pipe error) | `docker --version`, `docker info` |
| Flutter | **NOT INSTALLED** (`flutter` not recognized) | PowerShell |

Spring Boot 4.1.2 + Java 25 compatibility was checked against the official
system requirements page (Boot 4.1.x supports Java 17–26; Spring Framework
7.0.9+) before implementation.

## 2. Backend — `mvn test` (REAL, PASSED)

Command (exact):

```powershell
cd stacks/01-java25-springboot-react-flutter/backend
$env:JAVA_HOME='C:\Program Files\Java\jdk-25.0.2'
mvn test
```

Result: **BUILD SUCCESS, EXIT 0** — 29 tests (last full run after the
trusted-proxy XFF fix; includes `ClientIpResolutionTest`).

```text
[INFO] Tests run: 7,  Failures: 0, Errors: 0, Skipped: 0 -- AlgorithmEngineTest
[INFO] Tests run: 14, Failures: 0, Errors: 0, Skipped: 0 -- ApiIntegrationTest
[INFO] Tests run: 3,  Failures: 0, Errors: 0, Skipped: 0 -- EnvelopeContractTest
[INFO] Tests run: 2,  Failures: 0, Errors: 0, Skipped: 0 -- ProdCookieConfigTest
[INFO] Tests run: 3,  Failures: 0, Errors: 0, Skipped: 0 -- ClientIpResolutionTest
[INFO] Tests run: 29, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

What the 20 tests cover:

- `AlgorithmEngineTest` (7): fixed-catalog correctness (FizzBuzz, palindrome,
  Fibonacci, reverse), input bounds (oversized, non-numeric, out-of-range),
  measured-duration-vs-complexity distinction, catalog safety (no eval).
- `ApiIntegrationTest` (10, real HTTP server + H2 + Flyway): register (201 +
  envelope), invalid email/weak password (400 VALIDATION_ERROR), duplicate
  email (409 EMAIL_TAKEN, no exception leakage), login success + protected
  home with session cookie, generic invalid-credentials (no enumeration),
  unauthenticated 401 for protected endpoints, algorithm run with measured
  duration + complexity, unknown algorithm (400) and oversized input
  (INPUT_TOO_LARGE), logout invalidates the session server-side.
- `EnvelopeContractTest` (3): repository API envelope shape on success and
  error, stable codes + safe messages, no secret-looking values in committed
  resources.

Issues found and fixed during real runs (all resolved, suite green):

1. Spring Boot 4 starter renames (`-web` → `-webmvc`), Jackson 3 package
   (`tools.jackson.*`), `TestRestTemplate` relocation to
   `org.springframework.boot.resttestclient` (+ `spring-boot-starter-restclient`
   needed on the test classpath).
2. `DATABASE_TO_UPPER=false` in the H2 URL breaks Hibernate 7.4 schema
   validation against Flyway-created tables — removed from URLs.
3. H2 pinned to **2.3.232**: Hibernate 7.4 validation fails with 2.4.240 and
   Flyway 12.4.0 verifies only up to 2.3.232 (documented in ARCHITECTURE.md;
   re-evaluate on upgrades).
4. Session had to store the standard `SPRING_SECURITY_CONTEXT` attribute for
   HttpSessionSecurityContextRepository; authentication manager exposed as a
   bean; `/api/v1/algorithm/**` matcher fixed (`/run` was falling through to
   `denyAll()` → 403).
5. Review fix: prod cookie hardening was a silent no-op — `secure: true` was
   nested under the non-existent `spring.server.*` namespace instead of
   `server.servlet.session.cookie.secure` (verified against Boot 4.1.2
   configuration metadata in `spring-boot-web-server`); same for
   `server.max-http-request-header-size`. Both moved to the correct
   namespaces; `ProdCookieConfigTest` (2 tests) now asserts the YAML structure
   and fails if the nesting regresses (mutation-checked).
6. Review fixes (2nd round, 5 threads): (a) H2 console dev-profile detection
   now uses injected `Environment.acceptsProfiles` (the JVM system property
   is not set when the profile comes from env/yml); (b) CSRF exemption
   narrowed to register/login only — all other state-changing calls must echo
   XSRF-TOKEN (CsrfCookieFilter re-issues the cookie; unauthenticated callers
   get 401, authenticated-but-silent get 403, both test-asserted); web and
   mobile clients updated to echo the token; (c) `ALLOWED_ORIGINS` is now
   really bound via `app.cors.allowed-origins` `@Value`; (d) login throttle
   reworked: keyed on email+client-IP, counts only FAILED attempts, atomic
   `cache.asMap().compute`, pinned window (no sliding), success clears the
   tally, and exceeding the limit returns **HTTP 429 + Retry-After: 60**
   (was 400). Backend suite grew to 25 tests (429 coverage, success-does-not-
   throttle coverage, CSRF-silent-403 coverage), web to 13 (CSRF echo).
7. Orchestrator review round (run 9d3e9d91) follow-up: added a dedicated
   CORS preflight test — allowlisted origin gets
   `Access-Control-Allow-Origin` + credentials grant, unknown origin gets
   none (compose/prod deployment case). Backend suite now 26 tests; full
   `mvn test` re-run green after the addition.
8. Review round 3 fix: X-Forwarded-For was trusted unconditionally in the
   login throttle's client-IP resolution, letting a client rotate spoofed
   identities to bypass the 429 limit. Now XFF is honored only when the
   immediate TCP peer matches `app.trusted-proxies` (default EMPTY = XFF
   ignored, remoteAddr is the identity); in trusted-proxy mode the chain is
   walked right-to-left and the first untrusted hop is used. Config in
   `application.yml` + `.env.example` (`TRUSTED_PROXIES`), decision
   documented in ARCHITECTURE.md, covered by `ClientIpResolutionTest`
   (3 tests: default-ignores-XFF, spoofed-XFF-no-new-identity,
   trusted-chain-right-to-left).

## 3. Web — `npm test` + build (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/01-java25-springboot-react-flutter/frontend-web
npm.cmd install          # exit 0, 0 vulnerabilities
npm.cmd test             # vitest run
npm.cmd run build        # vite build
npx.cmd tsc --noEmit     # type check
```

Results:

```text
npm.cmd test   → Test Files 3 passed (3), Tests 13 passed (13), EXIT 0
npm.cmd run build → ✓ 43 modules transformed, dist/ emitted, EXIT 0
npx.cmd tsc --noEmit → EXIT 0 (clean)
```

Coverage: API client envelope handling (success/error/network-synthesis,
bounded payloads), Register page (accessible labels, submit, duplicate-email
alert), Login (generic error), Home (loading → data → logout button, error
state), Algorithm page (catalog load, run, measured time vs Big-O shown
separately, INPUT_TOO_LARGE alert).

## 4. Mobile — Flutter (NOT RUN — SDK missing)

**UNVERIFIED — `flutter analyze` / `flutter test` COULD NOT BE EXECUTED
because the Flutter SDK is not installed in this environment.** No version,
build, or test claim is made for `frontend-mobile/`. The Dart code is written
strictly against the frozen `/api/v1` contract (see `frontend-mobile/README.md`
and `../ARCHITECTURE.md`) and includes tests that document intended behavior —
they have never been executed. First action when the SDK is available:
`flutter pub get && flutter analyze && flutter test`.

## 5. Docker Compose (NOT RUN — daemon missing)

**UNVERIFIED — `docker info` cannot reach the daemon** (Docker Desktop engine
pipe missing), so `docker-compose.yml` and `backend/Dockerfile` are declared
but never executed. The compose file follows official image conventions
(PostgreSQL 16, Redis 7, healthchecks, only backend port published), but the
first real `docker compose up --build` must be treated as its verification run.

Post-remediation note: GitGuardian's generic-password detector flagged the
compose interpolation defaults whose failure messages contained the literal
word "password". The defaults were reworded to "credentials come from .env"
(no quoted pattern kept here, for the same detector's sake) — no values
changed, still non-reusable placeholders resolved only from `.env`.
Gitleaks (repository CI gate) passed both before and after.

## 6. Security review notes

- No secrets committed: `.env.example` files use non-reusable placeholders;
  `application.yml` prod profile fails fast without credentials.
- Envelope error responses never include stack traces/SQL (asserted by tests).
- Passwords: BCrypt; never logged or returned; account enumeration blocked
  (identical code+message for unknown email vs wrong password — test-asserted).
- Session fixation: login rotates the session; logout invalidates server-side.
- CSRF decision for `/api/**` (SameSite=Lax + strict CORS instead of
  double-submit cookies) is documented in ARCHITECTURE.md §3 with rationale.
- Login throttle: 10/min/email in-process — demo-grade, documented as such.
- Algorithm workbench: fixed catalog only; no user-code execution path exists
  (unit test asserts catalog safety); input bounded at 10,000 chars.

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Flutter analyze/test | **UNVERIFIED** | SDK not installed |
| Docker Compose run | **UNVERIFIED** | daemon not running |
| PostgreSQL data path | **UNVERIFIED** | only H2 exercised by tests |
| Browser e2e (Playwright) | not implemented | out of TASK-005 scope |
| Automated a11y audit | not implemented | out of TASK-005 scope (labels/roles are hand-checked) |
| Redis usage in backend | intentionally unused | no concrete need yet (per reference plan §6) |
| H2 2.3.232 pin | documented deviation | Hibernate 7.4 + H2 2.4 validation bug; re-check on upgrades |

## 8. stack.json verification flags

- `manifest`: **true** — schema-checked against `schemas/stack-manifest.schema.json` structure (id pattern, maturity enum, verification block; CI validate-catalog re-checks).
- `unit`: **true** — AlgorithmEngineTest + EnvelopeContractTest really ran green.
- `integration`: **true** — ApiIntegrationTest (HTTP + JPA + Flyway + Security) really ran green.
- `e2e`: **false** — no automated browser/native e2e was run.
- `lastVerifiedAt`: 2026-10-24T17:00:00Z (UTC timestamp of the green run).
- `evidencePath`: `verification.md` (this file).
