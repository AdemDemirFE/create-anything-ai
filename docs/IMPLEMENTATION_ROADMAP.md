# Implementation Roadmap

## Guiding strategy

Do not attempt to create 40 full applications in one run. Build the repository's **control plane** first: schemas, catalog, generator, security, test harness, and one reference stack. Once the path is repeatable, expand in batches.

## Phase 0 — Repository foundation

Deliverables:
- Root structure and documentation.
- `stacks/catalog.json` with all 40 IDs and maturity `proposed`.
- JSON Schema for stack manifests and generation plans.
- Root `.gitignore`, license, contribution guide.
- Agent policies and task contract.
- CI for markdown, JSON, secret scan, and catalog validation.

Acceptance:
- A clean checkout can validate schemas and catalog.
- Every catalog ID is unique and maps to the expected directory.
- No claim says all stacks are verified.

## Phase 1 — Generator MVP

Deliverables:
- CLI supports `--list-stacks`, `--stack`, `--target`, `--dry-run`, `--force` only with safe confirmation.
- Strict stack ID validation.
- Target path checks prevent traversal and accidental overwrite.
- Copy files deterministically and record generator version.
- `.env.example` copied as a template; no real `.env` secrets are generated into the source repository.
- Unit tests for invalid IDs, missing files, path traversal, existing targets, and dry-run.

Acceptance:
- Generator can scaffold a tiny fixture stack.
- A target outside the repository can be created reproducibly.
- Generator failure returns non-zero and does not leave a half-written target without a clear cleanup report.

## Phase 2 — Reference stack selection and compatibility

Choose one stack based on current environment, ecosystem support, and ability to test cleanly. Candidate 01 is useful as a broad example but has several toolchains; a simpler web stack may prove the generator faster. Decide in an ADR.

Deliverables:
- Official version compatibility evidence.
- Complete stack manifest and architecture.
- Authentication/session decision.
- Database migration and seed strategy.
- Four-screen mapping.
- Local Compose profile, if required.

Acceptance:
- Every runtime/framework pairing is validated against official docs.
- Commands are run on a clean environment.
- Unsupported or uncertain components are explicitly called out.

## Phase 3 — Reference implementation

Deliverables:
- Register, login, protected home, algorithm workbench.
- Backend authorization and validation.
- Responsive and accessible client UI.
- Health checks, structured logs, migrations, safe local seed data.
- Unit, integration, API contract, and browser smoke tests.
- Setup guide and troubleshooting.

Acceptance:
- A clean checkout can build, start, migrate, seed, test, and stop using documented commands.
- Unauthenticated requests cannot access protected backend resources.
- No default demo credentials are usable in production mode.
- Security scan findings are reviewed.

## Phase 4 — AI-assisted generation

Deliverables:
- Provider adapter interface.
- GLM/AIHub adapter behind explicit opt-in.
- Prompt/task templates with strict output and path contracts.
- Dry-run plan and cost/time limits.
- Human confirmation before overwriting files or running destructive commands.
- Result artifact with files changed, commands, test evidence, and failures.

Acceptance:
- AI mode does not execute arbitrary model output as shell commands without review.
- API keys are read from environment or a secret manager.
- Invalid model output is rejected and cannot escape the target directory.
- Network/API failure leaves the local generator usable.

## Phase 5 — Expand to 5 stacks

Select stacks with different architectures (e.g., one traditional backend, one BaaS, one AI/RAG, one mobile/desktop, one real-time). Avoid five stacks that only vary by CSS framework.

Acceptance:
- Each stack meets `spec-ready` and `scaffolded`.
- At least the first reference stack remains `verified`.
- Shared templates do not erase stack-specific differences.

## Phase 6 — Expand to all 40 catalog entries

For each stack:
1. Validate versions and compatibility.
2. Complete `stack.json` and specification docs.
3. Generate scaffold.
4. Implement minimal coherent application.
5. Run stack-specific tests and security review.
6. Record evidence and maturity.
7. Publish only after review.

Batch work by architecture family, not by arbitrary numeric ranges.

## Phase 7 — Release readiness

- Version the CLI and generator contract.
- Add release notes and migration policy.
- Validate Linux/macOS/Windows support claims.
- Test packaging and clean install.
- Review license compatibility of templates and dependencies.
- Publish provenance, SBOM where feasible, and known limitations.
- Document support policy and deprecation process.

## Stop conditions

Stop a phase and report a blocker when:
- runtime/framework compatibility cannot be established;
- secret handling is unsafe;
- tests are repeatedly flaky without diagnosis;
- agent changes overlap uncontrollably;
- generated code cannot be built from a clean state;
- a model or dependency is unavailable;
- a change would overwrite user data or mutate production systems.
