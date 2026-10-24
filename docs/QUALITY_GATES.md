# Quality Gates and Definition of Done

## Maturity gate matrix

| Gate | Proposed | Spec-ready | Scaffolded | Verified | Production-reference |
|---|---:|---:|---:|---:|---:|
| Unique manifest and schema valid | Required | Required | Required | Required | Required |
| Version compatibility documented | Planned | Required | Required | Required | Required |
| README/setup instructions | Planned | Required | Required | Required | Required |
| Generator mapping | No | Planned | Required | Required | Required |
| Generator tests | No | Planned | Required | Required | Required |
| Build and unit tests | No | Planned | Required where applicable | Required | Required |
| Integration/smoke tests | No | Planned | Planned | Required | Required |
| Security review | No | Checklist | Basic scan | Reviewed | Reviewed and recurring |
| Clean-room setup | No | No | Basic | Required | Required |
| Operational runbook | No | No | No | Basic | Required |
| Backup/restore and rollback evidence | No | No | No | Where applicable | Required |
| Release evidence | No | No | No | Required | Required |

## Repository-wide gates

### Gate A — Structure
- Required files and directories exist.
- No duplicate stack IDs.
- Manifest schema passes.
- Stack ID equals directory name.
- Catalog references resolve.

Automated today by the `validate-catalog` job in `.github/workflows/ci.yml` (strict whenever the catalog exists; reports and skips during bootstrap when `stacks/`/`schemas/` are entirely absent): catalog must contain exactly 40 stacks with unique well-formed ids, unique `number` values in 1–40, maturity values from `catalog.maturityPolicy`, a `stacks/<id>/` directory per id containing `stack.json`, and manifests matching the structural rules of `schemas/stack-manifest.schema.json`. Not yet automated: verification evidence files (Gate F) and cross-references beyond the checks listed in the workflow.

### Gate B — Static validation
- Markdown lint and link checks where configured.
- JSON/YAML parse.
- Formatting and language lint.
- No TODO or stub is allowed where the feature is claimed complete. TODOs may exist only when clearly scoped as follow-up work and maturity is not overstated.

Automated today: JSON parsing for `stacks/*.json` and `schemas/*.json` and catalog rule validation in CI. Not yet automated: markdown lint/link checks, general formatting/lint, and generator lint (these follow when the generator package exists).

### Gate C — Security
- Secret scan covers staged diff and repository history in dedicated audit workflow.
- `.env` and private key files are ignored and blocked from commits.
- Dependency vulnerability reports are reviewed.
- Authentication and authorization tests exist for protected functionality.
- No credentials in logs or test snapshots.
- Local Compose does not expose sensitive services unnecessarily.

Automated today by `.github/workflows/audit-secrets.yml`: Gitleaks (`gitleaks/gitleaks-action@v3`) on every pull request to `main`, push to `main`, and a weekly full-history scheduled scan with `fetch-depth: 0`. Dependabot (`.github/dependabot.yml`) monitors the `github-actions` and `npm` (`packages/generator`) ecosystems weekly. Not yet automated: license scanning and per-stack dependency vulnerability gates; these are reviewed manually until stack implementations land.

### Gate D — Build and test
- Clean dependency install succeeds.
- Build succeeds.
- Unit tests pass.
- Integration tests pass when data services are involved.
- API contract tests pass where an API exists.
- UI/e2e smoke test verifies all four journeys or documented equivalents.

### Gate E — Reproducibility
- Documented setup works from a clean checkout.
- Migrations work against a fresh database.
- Seed process is deterministic and safe.
- Startup and shutdown instructions work.
- Runtime/framework versions match tested versions.

### Gate F — Human review
- Diff is within assigned scope.
- Architecture and threat model are reviewed.
- Accessibility and error states are reviewed.
- Limitations and skipped checks are stated.
- Release/maturity claim matches evidence.

## Acceptance test examples

- Unknown stack ID returns a clear error and non-zero exit code.
- Target path `../../important-folder` is rejected or safely resolved according to documented policy.
- Existing non-empty target is never overwritten without explicit opt-in.
- A missing required secret causes safe startup failure with a clear message.
- Register rejects invalid email and weak password according to policy.
- Duplicate email is handled without database exception leakage.
- Login rate limits are applied where supported.
- Protected API returns 401/403 when unauthenticated/unauthorized.
- Logout invalidates the session where the chosen auth model supports revocation.
- Algorithm workbench rejects oversized input and never executes arbitrary shell/code.
- Execution time is measured by the runtime's monotonic clock where available.
- No test claims success if its command was not executed.

## Evidence report

Every verified stack should have an evidence record, e.g. `verification/last-run.json` or a CI artifact:

```json
{
  "stack_id": "example-stack",
  "commit": "full-commit-sha",
  "verified_at": "ISO-8601 UTC timestamp",
  "environment": {"os": "linux", "runtime": "exact version"},
  "commands": [
    {"command": "npm test", "exit_code": 0, "result": "passed"}
  ],
  "security": {"secret_scan": "passed", "dependency_scan": "reviewed"},
  "known_gaps": []
}
```

Do not commit machine-specific paths, tokens, private logs, or sensitive environment details into evidence.

## CI implementation status (TASK-004)

The CI configuration described above was added in this repository, with these verification limits stated explicitly:

- Workflow YAML files were validated locally with PyYAML (syntax parse) and `actionlint` 1.7.7 (expression/context checks; found and fixed an invalid job-level `hashFiles` usage).
- The catalog validation logic was exercised locally against a copy of `stacks/catalog.json` and the current schemas, including negative tests with injected defects (bad maturity, out-of-range number, malformed id — all caught).
- Real GitHub Actions runs on PR #2 verified: `validate-catalog` (success, bootstrap-tolerant path), `generator-tests` (success with setup/test steps correctly skipped while `packages/generator` is absent), `ci-summary` (success), and the Gitleaks `Secret audit` (success, no secrets detected).
- The `validate-catalog` job is strict whenever `stacks/`/`schemas/` exist and only reports-and-skips when they are entirely absent (bootstrap phase). Once the catalog lands on `main`, the 40-stack rules enforce on every PR.
- The `generator-tests` job has not executed `npm ci`/`npm test` yet because the generator package does not exist. When the package lands, its first run is the real verification of that job.
- The weekly scheduled Gitleaks run has not fired yet; it starts after merge.
- Branch protection rules (required status checks) are a repository-settings change outside this repository's files and have not been applied.
