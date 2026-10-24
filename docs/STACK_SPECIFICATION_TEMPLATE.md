# Stack Specification Template

Copy this file into a new stack as `ARCHITECTURE.md` and complete every section. Replace examples with verified stack-specific facts.

## 1. Identity and maturity

- **ID:** `NN-stack-id`
- **Name:**
- **Category:** machine slug from `stacks/catalog.json` `categoryPolicy` (for example `enterprise-cross-platform`, `baas`, `classic-web`, `ai-native`, `mobile-first`, `desktop`, `native`, `realtime`, `realtime-3d`)
- **Maturity:** `proposed | spec-ready | scaffolded | verified | production-reference | blocked` — must be a member of the catalog's `maturityPolicy`
- **Owner:**
- **Last verified (UTC):**
- **Supported OS:**
- **License notes:**

This section must stay consistent with the stack's `stack.json`, which is validated against `schemas/stack-manifest.schema.json`.

## 2. Technology and compatibility matrix

| Component | Target version | Tested version | Support evidence | Notes |
|---|---|---|---|---|
| Language/runtime | | | Official release docs | |
| Backend framework | | | Official compatibility docs | |
| Web framework | | | Official docs | |
| Mobile/desktop framework | | | Official docs | |
| Database | | | Official docs | |
| Build/test tools | | | Official docs | |

Never mark a version as tested unless a clean environment ran the documented commands successfully.

## 3. Architecture

Describe:
- process boundaries;
- module and folder layout;
- API boundaries and DTOs;
- persistence and migrations;
- auth/session model;
- external dependencies;
- local development services;
- production deployment assumptions;
- data flow and trust boundaries.

## 4. Four-screen mapping

| Requirement | Implementation path/screen | Server-side protection | Tests |
|---|---|---|---|
| Register | | | |
| Login | | | |
| Home/dashboard | | | |
| Algorithm/workbench | | | |
| Logout/session revocation | | | |

For native and BaaS stacks, explain the equivalent. Do not invent URL routes that the framework does not use.

## 5. Environment variables

For every variable document:
- name;
- purpose;
- required/optional;
- safe local default, if any;
- secret/non-secret classification;
- consumer/service;
- validation behavior when missing.

Never put real secrets or reusable passwords in `.env.example`. Use placeholders such as `replace-with-generated-local-secret`; the app should fail safely when a required secret is absent.

## 6. Local setup

List exact prerequisites and version checks, then exact install, migrate, seed, run, test, and stop commands. Commands must be tested on the stated platform.

## 7. Database and migrations

Describe schema ownership, migration tool, migration rollback limitations, seed data, indexes, foreign keys, and local reset process. Demo accounts must use unique local-only credentials and must never be enabled in production.

## 8. Security

Cover input validation, auth, password hashing, authorization, CORS/CSRF, rate limits, file upload limits, secrets, logging, dependency scanning, and deployment exposure. Mark inapplicable controls with a reason.

## 9. Testing and acceptance

- Unit tests:
- Integration tests:
- API contract tests:
- UI/e2e tests:
- Accessibility checks:
- Dependency/security scans:
- Smoke tests:
- Clean-room setup:
- Known untested areas:

## 10. Operational readiness

Document health/readiness checks, logs, metrics, graceful shutdown, backup/restore, migrations, rollback, TLS, deployment secrets, and resource sizing where applicable.

## 11. Agent task plan

Break implementation into tasks with:
- task ID;
- owner role;
- file ownership;
- dependencies;
- acceptance criteria;
- verification command;
- expected artifacts.

If any task is executed in AI mode, the resulting plan must validate against `schemas/generation-plan.schema.json` and follow the command approval rules in `docs/GENERATOR_CONTRACT.md`.

## 12. Known limitations

List limitations honestly. Include features not implemented, platform differences, vendor lock-in, and compatibility gaps.
