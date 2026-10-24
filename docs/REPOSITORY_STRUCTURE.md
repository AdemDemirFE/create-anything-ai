# Repository Structure Contract

## Root layout

```text
.
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── audit-secrets.yml
├── .ai-agents/
│   ├── AGENTS.md
│   ├── CLAUDE.md
│   ├── OPENCODE.md
│   ├── GEMINI.md
│   ├── OPENAI_CODEX.md
│   ├── GLM.md
│   ├── KIMI.md
│   ├── CURSOR_RULES.md
│   └── SKILLS.md
├── docs/
│   ├── adr/
│   ├── PRODUCT_REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── REPOSITORY_STRUCTURE.md
│   ├── STACK_CATALOG.md
│   ├── STACK_SPECIFICATION_TEMPLATE.md
│   ├── AGENT_ORCHESTRATION.md
│   ├── IMPLEMENTATION_ROADMAP.md
│   ├── QUALITY_GATES.md
│   ├── SECURITY_GIT_RULES.md
│   ├── GENERATOR_CONTRACT.md
│   ├── GLM_AIHub_SETUP.md
│   ├── DEVELOPMENT_WORKFLOW.md
│   ├── TESTING_STRATEGY.md
│   └── TUTORIALS_RESOURCES.md
├── schemas/
│   ├── stack-manifest.schema.json
│   └── generation-plan.schema.json
├── scripts/
│   ├── bootstrap.sh
│   ├── create-project.js
│   ├── validate-catalog.js
│   ├── audit-secrets.sh
│   └── glm-generator.js
├── templates/
│   └── shared/
├── stacks/
│   ├── catalog.json
│   ├── 01-java25-springboot-react-flutter/
│   └── ...
├── tests/
│   ├── generator/
│   ├── manifests/
│   └── security/
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
├── package.json
└── README.md
```

## Directory ownership

| Path | Responsibility | Primary owner |
|---|---|---|
| `.ai-agents/` | Agent policies and provider adapters | Orchestrator |
| `docs/` | Product and engineering contracts | Docs/Architecture agent |
| `schemas/` | Machine-readable contracts | Architecture agent |
| `stacks/catalog.json` | Canonical stack index | Catalog owner only |
| `stacks/<id>/stack.json` | One stack's metadata | Stack owner |
| `stacks/<id>/` source | Stack implementation | Assigned stack worker |
| `scripts/` | CLI and automation | Tooling agent |
| `.github/workflows/` | CI and security automation | CI/Security owner |
| `tests/` | Shared validation tests | QA owner |

## File naming and layout rules

- Use lowercase kebab-case for new directories and filenames, except mandated ecosystem files such as `README.md`, `Dockerfile`, and `AGENTS.md`.
- Every stack ID must match its directory name exactly.
- Keep generated target projects outside the repository by default.
- Do not put generated application source directly under the repository root.
- Do not copy repository-wide `.ai-agents/` into a generated project unless the generator explicitly supports it and the user opts in.
- Each stack must declare the intended output layout; do not assume all stacks have `backend/` and `frontend/`.
- Avoid duplicated policies. Link to the canonical policy instead of copying large instructions into every stack.
- Never use an unreviewed generated file as the source of truth for another generated file.

## Required stack files

Minimum for `spec-ready`:
- `stack.json`
- `README.md`
- `ARCHITECTURE.md`
- `AI_SETUP.md`
- `.env.example` only if environment configuration is required
- `docker-compose.yml` only if local services are used
- `verification.md` with commands and known limitations

Minimum for `scaffolded`:
- all `spec-ready` files;
- a working generator mapping;
- safe target-path handling;
- a test confirming expected files are created.

Minimum for `verified`:
- actual implementation;
- automated tests;
- clean setup instructions;
- smoke test results;
- compatibility evidence;
- security review result.

## Avoiding catalog drift

Any change to a stack's ID, category, maturity, or tech versions must update:
1. the stack's `stack.json`;
2. `stacks/catalog.json`;
3. generated catalog docs or the manually maintained table;
4. relevant tests and compatibility notes.

Prefer generating the Markdown catalog from JSON rather than maintaining the same data by hand.
