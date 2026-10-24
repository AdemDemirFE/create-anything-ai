# Contributing to Create Anything AI

Thank you for contributing. The goal is repeatable, secure, verifiable project generation—not a large collection of untested folders.

## Branch naming

Work on short-lived feature branches derived from `main`:

- `feat/repository-foundation` — repository scaffolding, docs, and agent ledger.
- `feat/stack-<id>-<slug>` — one stack's specification/implementation, e.g. `feat/stack-01-java25-springboot-react-flutter`.
- `feat/stack-catalog-schema` — catalog and JSON Schema contracts.
- `feat/generator-cli` — generator tooling.
- `feat/ci-security` — CI workflows and security automation.
- `fix/<scope>`, `docs/<scope>`, `security/<scope>` for non-feature changes.

One branch = one bounded scope. Do not mix unrelated changes into a stack branch.

## Commit messages

This repository uses [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <short imperative summary>

<optional body explaining what and why>
```

Common types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `ci`, `security`. Examples:

- `docs: add multi-agent orchestration protocol`
- `feat(schemas): add stack manifest JSON Schema`
- `chore: add .gitignore for multi-stack workspace`

Stage files deliberately (`git add <path>`); avoid `git add .` so unrelated or generated files do not slip into a commit.

## Before opening a PR
- Search for an existing stack or shared feature.
- Read `docs/ARCHITECTURE.md`, `docs/QUALITY_GATES.md`, and `docs/SECURITY_GIT_RULES.md`.
- Open an issue or task for cross-cutting changes.
- Never include secrets, real user data, or generated local environment files.

## PR standards

Every pull request must describe:

1. **Changes** — what changed and why, with the task or issue it belongs to.
2. **Tests run** — the exact commands executed and their actual results (not claims). If nothing was runnable, state that explicitly and list what CI will cover.
3. **Security assessment** — secrets exposure, dependency changes, path/traversal handling, auth impact, or "no security-relevant change" with reasoning.
4. **Known gaps** — what is intentionally not done, stubbed, or deferred, so reviewers are not surprised.

Keep PRs small and reviewable; a PR that claims to finish a stack without test evidence will be rejected.

## Adding a stack
1. Select the next unused ID and create `stacks/NN-stack-id/`.
2. Add `stack.json` and validate it against `schemas/stack-manifest.schema.json`.
3. Add `README.md`, `ARCHITECTURE.md`, `AI_SETUP.md`, and `verification.md`.
4. Document official compatibility evidence and the date checked.
5. Implement the smallest coherent application, not empty folders presented as a completed stack.
6. Add tests and safe environment templates.
7. Update `stacks/catalog.json`; regenerate the human-readable catalog if the tool exists.
8. Run the quality gates and attach actual results.
9. Open a focused PR.

## Definition of done
A PR must state:
- problem and solution;
- files changed;
- commands run and results;
- security impact;
- compatibility evidence;
- known limitations;
- maturity state before and after.

## Versioning
Do not silently update major framework versions. Explain compatibility changes, migration impact, and tested versions.

## Agent-generated changes
AI-generated code is welcome but receives the same review and testing requirements as human-written code. Agent completion messages are not proof of correctness; CI and reproducible tests are.
