# Reference Stack 01 — Implementation Plan

## Proposed stack
`01-java25-springboot-react-flutter`

The initial proposal combines Java/Spring Boot, React/Vite, Flutter, PostgreSQL, and Redis. Before implementation, validate the exact Java and Spring Boot pairing from official compatibility documentation. The requested versions are targets, not guaranteed compatible versions.

## Suggested directory layout

```text
stacks/01-java25-springboot-react-flutter/
├── stack.json
├── README.md
├── ARCHITECTURE.md
├── AI_SETUP.md
├── .env.example
├── docker-compose.yml
├── backend/
│   ├── pom.xml
│   ├── mvnw
│   ├── mvnw.cmd
│   └── src/
├── frontend-web/
│   ├── package.json
│   └── src/
├── frontend-mobile/
│   ├── pubspec.yaml
│   └── lib/
├── tests/
└── verification.md
```

Do not create empty folders as proof of implementation. Add each client only when it has a buildable minimal path.

## Contract decisions to make before parallel implementation

1. API prefix and versioning (e.g. `/api/v1`).
2. Auth strategy for browser and mobile clients.
3. Error envelope and validation format.
4. DTO naming and date/time formats.
5. Database migration tool and ownership.
6. Redis use cases; do not add Redis without a concrete need.
7. CORS policy and local origins.
8. Health/readiness endpoints.
9. Ports and Compose network.
10. Seed-data policy and production disablement.

## Suggested task split

- Backend worker: API, domain, auth, migrations, unit/integration tests.
- Web worker: React screens and API client, using a frozen OpenAPI/DTO contract.
- Mobile worker: Flutter screen mapping and secure token storage, after API contract freeze.
- Infra worker: Compose, health checks, environment docs; no application feature edits.
- Security worker: auth/session review, CORS/CSRF, secrets, dependency scan.
- QA worker: test harness and clean-room acceptance.
- Coordinator: contracts, task dependencies, integration and final gates.

## Initial acceptance criteria

- Backend starts with documented local configuration.
- Fresh database migration succeeds.
- Register/login work against persistent storage.
- Protected endpoint rejects unauthenticated requests.
- Web app implements the four journeys with error/loading states.
- Flutter app maps the journeys to native screens or documents a staged implementation.
- Algorithm workbench uses fixed safe algorithms and bounded input.
- Unit/integration tests pass.
- Compose services have health checks and are not exposed more broadly than necessary.
- `.env.example` contains no reusable passwords or secret-looking values.
- Verification evidence lists exact tested runtime versions and commands.
