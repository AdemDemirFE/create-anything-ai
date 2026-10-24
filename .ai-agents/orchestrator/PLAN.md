# Orchestrator Plan — Create Anything AI

This ledger is the coordination state for the multi-agent build-out described in
`docs/AGENT_ORCHESTRATION.md`. Workers read it; only the orchestrator (or a worker
explicitly assigned integration duty) updates it.

## Goal

Deliver the repository in waves (see `docs/IMPLEMENTATION_ROADMAP.md`):

1. **Wave 1 — Foundation:** repository docs, catalog + schemas, CI, security automation.
2. **Wave 2 — Generator:** generator CLI with safe target handling and tests.
3. **Wave 3 — Reference stack:** stack 01 implemented and verified end-to-end.
4. **Wave 4 — Scale:** remaining catalog entries in batches, individual maturity tracking.

## Principles

- File ownership is exclusive; shared files are single-writer (see `docs/REPOSITORY_STRUCTURE.md`).
- No worker commits or pushes unless assigned; integration is centralized.
- Claims require evidence: commands run, exit codes, test results.
- Maturity advances only through `docs/QUALITY_GATES.md`.

## Current wave

Wave 1 — Foundation (tasks TASK-001 … TASK-004 running in parallel, TASK-005/006 queued).
