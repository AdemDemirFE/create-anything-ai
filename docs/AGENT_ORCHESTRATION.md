# Multi-Agent Orchestration Protocol (6–7 GLM Workers)

## 1. Objective

Run multiple GLM-5.3-Flash-IT agents concurrently while keeping architecture consistent, changes reviewable, token use controlled, and Git history safe. The orchestration policy is provider-neutral; AIHub is the initial model gateway.

## 2. Recommended topology

Use one coordinator and up to six workers (7 agents total). If the coordinator is itself counted as one of the 6–7 active agents, run five or six workers.

| Role | Main responsibility | Allowed scope | Must not do |
|---|---|---|---|
| Coordinator / Lead | Plan, assign, resolve interfaces, integrate | Task plan, integration decisions, final report | Let workers edit the same shared file without a lock |
| Architecture / Catalog | Schemas, ADRs, stack manifests, compatibility | `schemas/`, assigned catalog files, ADRs | Implement application features outside task |
| Tooling / Generator | CLI, templates, bootstrap, validation | `scripts/`, `templates/`, generator tests | Change stack APIs without approval |
| Stack Backend | One stack's backend and persistence | Assigned stack's backend subtree | Edit global policy/catalog unless assigned |
| Stack Client | Same stack's web/mobile UI | Assigned stack's client subtree | Modify backend contracts unilaterally |
| Security | Threat model, secret scan, auth review | Findings and assigned security files | Rewrite feature code without task/owner agreement |
| QA / Docs | Test plan, acceptance tests, docs and evidence | Assigned tests/docs | Claim commands passed without running them |

Roles can be combined for small changes. Do not assign six workers to six independent stacks before the reference architecture is proven.

## 3. Work units and task contracts

Every task must include:

```yaml
task_id: CAI-###
objective: One measurable outcome
context:
  stack_id: ""
  source_of_truth:
    - docs/ARCHITECTURE.md
    - docs/QUALITY_GATES.md
scope:
  allowed_paths: []
  forbidden_paths:
    - .env
    - secrets/
dependencies: []
interfaces:
  inputs: []
  outputs: []
acceptance_criteria: []
verification_commands: []
risk: low
completion_report_required:
  - summary
  - files_changed
  - commands_run
  - test_results
  - assumptions
  - known_gaps
```

Task size target: one coherent outcome that can be reviewed in 15–90 minutes. If a task touches multiple subsystems, split it.

## 4. Concurrency rules

- Parallelize independent files, not merely independent ideas.
- Assign one owner per file. Shared files (`catalog.json`, root README, schema, package manifest, workflows) are single-writer resources.
- Workers may propose edits to shared files in a report or patch; only the designated owner applies them.
- Use separate branches or worktrees for workers if the runtime supports them. Never let multiple agents share one mutable working directory without file-level locking and a coordinator.
- No concurrent `git add`, commit, rebase, cherry-pick, reset, or push from worker agents. One integrator owns Git mutations.
- Do not start duplicate development servers on the same port; assign unique ports or run tests serially.
- Do not allow multiple agents to run destructive database resets against the same database.
- Use explicit task dependencies. A client agent must consume a versioned API contract before coding against it.
- Limit retries. After two failed attempts, require a diagnosis and changed strategy instead of repeating the same prompt.

## 5. Recommended execution waves

### Wave 0 — Coordinator only
- Inspect repository and Git status.
- Read relevant policies.
- Define deliverables, task IDs, owners, file boundaries, dependencies, and acceptance criteria.
- Confirm model endpoint and a minimal API request before launching workers.

### Wave 1 — Foundations (parallel)
- A: repository structure and schemas.
- B: security and quality gates.
- C: generator CLI contract and test design.
- D: reference-stack compatibility research.
- E: CI workflow plan.
- Coordinator: consolidate interfaces and resolve conflicts.

### Wave 2 — Reference stack (parallel after contract freeze)
- Backend implementation.
- Web client implementation.
- Database/Compose and migration.
- Test automation.
- Security review.
- Docs/clean-room instructions.

### Wave 3 — Integration
- Freeze feature changes.
- Integrator runs validation and tests.
- Workers fix assigned findings only.
- Repeat gates until pass or report blockers.

### Wave 4 — Next stack
- Copy the proven specification and generator contract.
- Change only stack-specific adapter/template code.
- Do not clone every implementation pattern blindly; record deviations.

## 6. Agent prompt template

```text
You are worker <ROLE> for Create Anything AI.
Read .ai-agents/AGENTS.md and the task's referenced policies first.

Task: <TASK_ID>
Objective: <ONE OUTCOME>
Allowed paths: <PATHS>
Forbidden paths: <PATHS>
Dependencies/interfaces: <CONTRACTS>
Acceptance criteria:
- <CRITERION>
Verification commands:
- <COMMAND>

Rules:
- Do not change files outside allowed paths.
- Do not edit shared files owned by another agent.
- Do not run destructive commands or access production systems.
- Do not fabricate test results or compatibility claims.
- Do not add secrets, real credentials, or placeholder implementations presented as complete.
- If blocked, stop and report the exact blocker and evidence.
- Do not commit or push; the coordinator integrates changes.

Completion report:
1. Summary
2. Files changed
3. Commands run and exit codes
4. Tests and results
5. Assumptions
6. Known gaps / follow-up tasks
```

## 7. Context and token efficiency

- Read root `AGENTS.md` once per session; then read only task-relevant docs.
- Give agents file paths and concise acceptance criteria, not the entire repository text.
- Ask for a plan before implementation for tasks with more than five files.
- Require a compact handoff report; do not ask every worker to summarize the entire codebase.
- Use manifest IDs and interface contracts rather than duplicating stack descriptions.
- Keep one canonical version of policies; link to it.
- Store decisions in ADRs and task artifacts, not repeated chat history.
- Use model output limits appropriate to the task; prefer patches and targeted diffs over full-file rewrites.
- Do not rely on the model's context-window claim as a substitute for focused context.

## 8. GLM-5.3-Flash-IT operating guidance

- Use GLM for bounded implementation, tests, documentation, and review tasks where it is effective.
- Validate output using compilers, test runners, linters, schema validators, and security tools.
- Keep the provider endpoint, model ID, timeout, retry limits, and concurrency limits configurable.
- Avoid embedding AIHub credentials in prompts, command lines, generated files, or logs.
- Start with low concurrency (one request, then two workers) and increase to 6–7 only after rate limits, latency, failure rates, and context use are measured.
- Use exponential backoff with jitter for retryable `429`, `502`, `503`, and network errors; do not retry authentication or malformed-request errors indefinitely.
- Set a per-task budget and global concurrency cap. Stop runaway tasks by deadline and token budget.
- Never assume “Flash” means a task does not need review.

## 9. Integration checklist

- [ ] All worker scopes were respected.
- [ ] Shared files have one integrated final version.
- [ ] No unexpected files or generated binaries.
- [ ] Formatting and manifest validation pass.
- [ ] Tests were run from a clean or reproducible state.
- [ ] Security findings are triaged.
- [ ] Documentation matches the actual implementation.
- [ ] Remaining failures and limitations are listed explicitly.
