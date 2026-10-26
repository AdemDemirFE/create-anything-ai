# Create Anything AI -

> **One Prompt to a Verified Project Blueprint.**
>
> A multi-agent, multi-stack open-source toolkit for generating, validating, and maintaining application starters.

Create Anything AI is a repository of **versioned stack specifications, reusable AI-agent instructions, secure scaffolding tools, verification contracts, and implementation playbooks**. It is designed to be developed incrementally by an agentic team—typically 6–7 concurrent workers using GLM-5.3-Flash-IT through AIHub—without allowing parallel work to corrupt shared files or silently lower quality.

> **Important:** This repository is a blueprint and generator framework. A stack is not “production-ready” merely because its directory exists. A stack earns that status only after its implementation, compatibility, security, tests, documentation, and reproducible setup pass the gates defined in `docs/QUALITY_GATES.md`.

## Current status (repository foundation)

The repository is in **Phase 0** of `docs/IMPLEMENTATION_ROADMAP.md`. Right now it contains:

- Project and engineering documentation under `docs/` (being added progressively).
- Agent policies and provider adapters under `.ai-agents/`.
- `.gitignore`, `LICENSE`, `CONTRIBUTING.md`, and this README.
- The multi-agent task ledger under `.ai-agents/orchestrator/`.

Not yet implemented (planned, not existing): `stacks/`, `schemas/`, `scripts/`, `templates/`, `tests/`, CI workflows, and any generated project. The repository map below is the target contract, not a claim that these directories exist today.

## Product principles

1. **Spec before code:** every stack has a machine-readable manifest and a human-readable specification.
2. **Reproducible generation:** same inputs and generator version should produce equivalent output.
3. **Secure by default:** no committed secrets, no default production credentials, least privilege, and explicit handling of generated `.env` files.
4. **Verified, not asserted:** claims such as “tests pass” must be backed by recorded command results.
5. **Small parallel tasks:** agents own bounded files and interfaces; shared-file edits are serialized.
6. **Stack-specific reality:** the universal experience is a product requirement, not an excuse to force inappropriate technologies or fake features into every stack.
7. **Human approval for risky actions:** deployment, destructive commands, external publication, credential rotation, and production data operations require explicit approval.
8. **Incremental catalog growth:** implement and validate one reference stack first, then expand using proven templates.

## Repository map

```text
create-anything-ai/
├── .github/workflows/              # CI, secret audit, markdown and manifest checks
├── .ai-agents/                     # Provider-neutral rules and provider adapters
├── docs/                            # Architecture, security, orchestration, quality gates
├── schemas/                         # JSON Schema contracts for stack manifests and plans
├── scripts/                         # Bootstrap, validation, secret checks, GLM generator
├── templates/                       # Shared files and generator templates
├── stacks/
│   ├── catalog.json                 # Canonical stack index
│   ├── 01-.../                      # Stack specifications and implementations
│   └── ...
├── tests/                           # Generator, manifest, security and smoke tests
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

See `docs/REPOSITORY_STRUCTURE.md` for the full directory contract.

## Quick start (repository development)

```bash
git clone <your-repository-url>
cd create-anything-ai
node --version
npm --version
npm ci
npm run validate
```

The commands above become available when the corresponding `package.json` and scripts are implemented. Until then, use the individual validation commands documented in `docs/DEVELOPMENT_WORKFLOW.md`.

## Generate a project

The intended interface is:

```bash
npx create-anything-ai my-app --stack=01-java25-springboot-react-flutter
```

The generator must validate the stack ID, confirm the target path, copy only approved template files, render configuration, and report the next steps. It must **not** claim to have generated a complete working application if only a skeleton was copied.

For the initial repository MVP, support a transparent local workflow first:

```bash
node scripts/create-project.js --stack=01-java25-springboot-react-flutter --target=../my-app
```

AI-driven implementation is a separate, explicit mode; see `docs/GENERATOR_CONTRACT.md`.

## Universal application baseline

The reference experience is four routes or equivalent screens:

- `/register`: registration with server-side validation and safe password hashing.
- `/login`: authentication with a documented session/token strategy.
- `/home`: protected profile/dashboard and logout.
- `/algorithm`: a bounded interactive algorithm or domain-workbench with timing and explanation.

Native mobile apps may implement these as screens rather than literal URL paths. Backend-for-frontend and managed BaaS stacks must document the equivalent implementation. Do not pretend client-side-only validation is security.

## Stack catalog

The target catalog contains 40 proposed combinations. The canonical list and maturity states belong in `stacks/catalog.json`; the table in `docs/STACK_CATALOG.md` is its human-readable companion.

**Maturity labels**
- `proposed`: idea recorded, not yet validated.
- `spec-ready`: compatibility and design documented.
- `scaffolded`: generator can create the structure.
- `verified`: clean setup, tests and smoke checks pass.
- `production-reference`: operational, security, upgrade and recovery evidence exists.

Do not label all 40 stacks production-ready before the evidence exists.

## Multi-agent development

The recommended operating model is one coordinator plus 5–6 bounded workers:

1. **Orchestrator / Tech Lead** — plans tasks, resolves dependencies, owns integration decisions.
2. **Architecture & Manifest Agent** — schemas, stack manifest, compatibility matrix.
3. **Implementation Agent A** — one stack's backend and persistence.
4. **Implementation Agent B** — one stack's frontend/mobile client.
5. **Security Agent** — threat review, secrets, auth, dependency and workflow audit.
6. **QA Agent** — tests, clean-room verification, acceptance evidence.
7. **Docs / Release Agent** — documentation, examples, changelog and PR readiness.

Run 6–7 agents concurrently only when task boundaries are independent. Use the task contracts in `docs/AGENT_ORCHESTRATION.md`; avoid having multiple agents edit the same file or perform Git mutations concurrently.

## Documentation index

- `docs/PRODUCT_REQUIREMENTS.md` — goals, non-goals and user journeys.
- `docs/ARCHITECTURE.md` — architecture and shared contracts.
- `docs/REPOSITORY_STRUCTURE.md` — file and folder responsibilities.
- `docs/STACK_CATALOG.md` — all 40 stack proposals and maturity.
- `docs/STACK_SPECIFICATION_TEMPLATE.md` — required stack documents.
- `docs/AGENT_ORCHESTRATION.md` — 6–7-agent execution model.
- `docs/IMPLEMENTATION_ROADMAP.md` — phased build plan.
- `docs/QUALITY_GATES.md` — definition of done.
- `docs/SECURITY_GIT_RULES.md` — secure development rules.
- `docs/GENERATOR_CONTRACT.md` — generator behavior and CLI contract.
- `docs/GLM_AIHub_SETUP.md` — AIHub / GLM operational setup.
- `docs/DEVELOPMENT_WORKFLOW.md` — local development and Git workflow.
- `docs/TESTING_STRATEGY.md` — automated test levels.
- `docs/TUTORIALS_RESOURCES.md` — official documentation sources.
- `.ai-agents/` — shared and provider-specific instructions.

## Contributing

Read `CONTRIBUTING.md`. Every PR must include a bounded scope, evidence, tests appropriate to the change, and no secret material.

## License

MIT. See `LICENSE`.
