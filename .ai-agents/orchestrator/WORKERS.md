# Worker Roles and File Ownership

Six workers plus one orchestrator coordinate through this ledger. Ownership below is
exclusive unless the orchestrator explicitly negotiates a handoff in `DECISIONS.md`.

| Worker | Role | Owned paths |
|---|---|---|
| worker-1 | Repository foundation, root docs, agent ledger | `README.md`, `CONTRIBUTING.md`, `LICENSE`, `.gitignore`, `.ai-agents/**`, foundation docs under `docs/` |
| worker-2 | Stack catalog and JSON Schemas | `stacks/catalog.json`, `schemas/**`, `docs/STACK_CATALOG.md`, `docs/STACK_SPECIFICATION_TEMPLATE.md` |
| worker-3 | Generator CLI and tooling | `scripts/**`, `templates/**`, generator tests under `tests/**` |
| worker-4 | CI and security automation | `.github/workflows/**`, `docs/SECURITY_GIT_RULES.md`, `docs/QUALITY_GATES.md`, secret-scan tooling |
| worker-5 | Reference stack 01 implementation | `stacks/01-java25-springboot-react-flutter/**` |
| worker-6 | Independent QA and verification | `tests/**`, verification evidence, clean-room checks |

Shared, single-writer files: root `README.md`, `stacks/catalog.json`, `package.json`,
CI workflow files. Changes to those go through the designated owner; others propose
edits via report or patch.
