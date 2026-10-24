# System Architecture

## 1. Architectural overview

The repository is organized into six layers:

1. **Catalog** — canonical stack IDs, names, maturity, supported platforms, runtime requirements.
2. **Specifications** — stack-specific design, versions, commands, environment variables, acceptance criteria.
3. **Templates** — reusable files and project starter templates.
4. **Generator** — validates inputs, copies templates, renders safe variables, and records provenance.
5. **Agent protocol** — instructions and task contracts used to implement or customize generated projects.
6. **Verification** — schema checks, secret scanning, linting, unit/integration/e2e tests, smoke tests, and evidence reports.

```text
User / CLI
   |
   v
Input validation ----> catalog.json + JSON Schema
   |
   v
Stack resolver ------> stack manifest + stack specification
   |
   v
Template renderer --> new target directory (outside source repository by default)
   |
   +---- optional AI implementation plan --> agent coordinator
   |                                          |
   |                               bounded worker tasks
   |                                          |
   +------------------------------------------+
   |
   v
Quality gates --> tests + security scans + evidence report
   |
   v
Verified handoff (never overstate unrun checks)
```

## 2. Source of truth

- `stacks/catalog.json` is the canonical catalog index.
- `schemas/stack-manifest.schema.json` validates individual stack manifests.
- Each stack's `stack.json` is the machine-readable specification.
- `docs/STACK_CATALOG.md` is a human-readable view and must be checked for drift.
- `docs/STACK_SPECIFICATION_TEMPLATE.md` defines mandatory documentation.
- Shared security and quality policies live under `docs/`; stack-specific docs may strengthen, but not weaken, those policies.

## 3. Stack isolation

Each stack is an independent unit with:
- `stack.json`
- `README.md`
- `ARCHITECTURE.md`
- `AI_SETUP.md`
- `.env.example`
- `docker-compose.yml` when local containers are part of the stack
- source folders for included applications
- tests and verification instructions
- `SECURITY.md` or a stack-specific security section where needed

Stacks may use different programming languages, package managers, test frameworks, and deployment models. Shared scripts must not assume every stack has Node.js or Docker.

## 4. Authentication and persistence

The four-screen baseline is a functional contract, not a mandated database schema. The actual schema must match the selected stack and ORM. A relational stack may use `users`, `sessions`, and `algorithm_logs`; a BaaS stack may use managed auth and RLS; a native local-first stack may use a local database and explicitly describe sync boundaries.

Never copy a PostgreSQL DDL snippet into a stack that uses Firestore, SQLite, or managed auth without adapting and testing it.

## 5. Shared interfaces

### Stack manifest (illustrative)

```json
{
  "id": "01-java25-springboot-react-flutter",
  "name": "Java / Spring Boot + React + Flutter",
  "category": "enterprise-cross-platform",
  "maturity": "proposed",
  "description": "A web API, browser client, and native mobile client.",
  "backend": {"language": "Java", "framework": "Spring Boot"},
  "web": {"framework": "React", "buildTool": "Vite"},
  "mobile": {"framework": "Flutter"},
  "data": ["PostgreSQL", "Redis"],
  "platforms": ["linux", "macos", "windows"],
  "requires": ["JDK", "Node.js", "Flutter SDK", "Docker"],
  "verification": {
    "manifest": true,
    "unit": false,
    "integration": false,
    "e2e": false
  }
}
```

The actual JSON Schema is authoritative. Do not add fields casually; update schema, examples, validators, and docs together.

### Generator result

A successful generator run should produce a machine-readable summary:

```json
{
  "status": "success",
  "stack_id": "01-java25-springboot-react-flutter",
  "generator_version": "0.1.0",
  "target": "../my-app",
  "files_created": 12,
  "warnings": [],
  "next_steps": ["Review .env.example", "Install dependencies"]
}
```

Never include secret values in logs or result files.

## 6. Version and compatibility policy

Framework versions in the original catalog are proposed targets, not proof of compatibility. For each stack:
- validate language/runtime and framework compatibility against official release documentation;
- pin a tested version range;
- document minimum and recommended tool versions;
- distinguish tested versions from latest versions;
- record the verification date;
- provide an upgrade policy;
- do not silently upgrade major versions in generated projects.

Where a combination is incompatible or unsupported, the stack owner must update the combination or mark it `blocked` with an explanation. Example: a framework version and language runtime may not share the same support window; do not infer compatibility from their names.

## 7. Observability

Generated reference applications should use:
- structured logs with request/correlation IDs;
- health and readiness endpoints where applicable;
- clear startup diagnostics;
- no secrets or sensitive personal data in logs;
- bounded metrics and algorithm timing;
- graceful shutdown and resource cleanup.

Do not require a full observability vendor integration for every starter. Keep optional integrations modular.

## 8. Error handling

- Validate inputs at boundaries.
- Translate expected domain errors into stable error codes.
- Keep internal exceptions and stack traces server-side.
- Include request IDs in server logs and client error envelopes.
- Ensure clients can distinguish validation, authentication, authorization, rate-limit, and transient server errors.

## 9. Deployment boundary

Local development Compose files must be explicitly labeled development-only unless hardened and tested for production. Do not expose databases to all network interfaces unnecessarily. Production deployment instructions must address TLS, backups, migrations, monitoring, secrets, rollback, and access control.

## 10. Architectural decision records

For decisions affecting multiple stacks, add `docs/adr/NNNN-title.md` with:
- context;
- decision;
- alternatives;
- consequences;
- migration plan;
- date and status.

Do not use a global ADR to force a stack-specific technology choice where the trade-off differs.
