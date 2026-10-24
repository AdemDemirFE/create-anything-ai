# Initial Agent Backlog

Use these as first tasks for the multi-agent system. Execute sequentially by wave; do not start all tasks at once.

## Wave 0 — coordinator
- [ ] CAI-001: inspect repository state and establish clean baseline; no destructive operations.
- [ ] CAI-002: decide reference stack and document compatibility research requirements.
- [ ] CAI-003: freeze stack manifest fields and generation-plan contract.

## Wave 1 — foundation
- [ ] CAI-010: implement catalog validator for `stacks/catalog.json`; reject duplicate IDs and invalid maturity.
- [ ] CAI-011: add catalog consistency test for directory IDs and documentation.
- [ ] CAI-012: add markdown/JSON/YAML CI checks.
- [ ] CAI-013: implement robust secret scan workflow with redacted output.
- [ ] CAI-014: define package scripts and lockfile policy.
- [ ] CAI-015: add contributor-facing stack template files.

## Wave 2 — generator MVP
- [ ] CAI-020: implement CLI parser and `--list-stacks`.
- [ ] CAI-021: implement manifest loading and JSON Schema validation.
- [ ] CAI-022: implement safe target path and overwrite protections.
- [ ] CAI-023: implement deterministic copy/render behavior.
- [ ] CAI-024: add generator unit tests, including path traversal.
- [ ] CAI-025: implement dry-run with zero side effects.

## Wave 3 — reference stack
- [ ] CAI-030: validate candidate stack versions against official sources.
- [ ] CAI-031: freeze API/auth/error contracts.
- [ ] CAI-032: implement backend and persistence.
- [ ] CAI-033: implement web client.
- [ ] CAI-034: implement mobile client only after API contract freeze.
- [ ] CAI-035: implement Compose and safe local environment.
- [ ] CAI-036: implement tests and clean-room verification.
- [ ] CAI-037: security review and threat-model sign-off.
- [ ] CAI-038: update maturity and evidence only after gates pass.

## Wave 4 — scale out
- [ ] CAI-040: choose four contrasting next stacks.
- [ ] CAI-041: implement stack manifests and specs in parallel with single-file ownership.
- [ ] CAI-042: build reusable generator adapters without flattening stack differences.
- [ ] CAI-043: verify each stack and update maturity individually.

## Task completion standard
Every task must report changed files, exact commands, exit codes, test results, assumptions, and known gaps. A worker saying “done” is not sufficient evidence.
