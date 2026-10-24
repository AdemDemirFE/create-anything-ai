# Security, Secrets, and Git Rules

## 1. Security baseline

Security requirements apply to the generator, agent workflow, templates, and generated applications.

- Treat prompts, model output, repository issues, dependency scripts, and generated files as untrusted input.
- Use least privilege for local tools and CI permissions.
- Never run model-generated shell commands automatically without a policy check and, for risky actions, human approval.
- Never point development agents at production credentials or production data.
- Use supported dependencies and review vulnerability findings.
- Pin GitHub Actions to reviewed versions or immutable commit SHAs where practical.
- Set workflow permissions explicitly and keep them read-only unless a job needs more.
- Protect the default branch and require review/status checks for releases.

### Current CI implementation

Two workflows exist under `.github/workflows/`:

- `ci.yml` (triggers: `pull_request` targeting `main`, `push` to `main`):
  - `validate-catalog` job: parses every JSON file under `stacks/` and `schemas/`, enforces catalog rules (exactly 40 stacks, unique and well-formed ids, unique `number` values within 1–40, `maturity` values from `catalog.maturityPolicy`, each stack id matching an existing `stacks/<id>/` directory containing `stack.json`), checks manifests against the structural rules of `schemas/stack-manifest.schema.json` (required keys, id pattern, maturity enum, boolean verification flags), and verifies the schema files referenced by the catalog contract exist.
  - `generator-tests` job: runs `npm ci` + `npm test` in `packages/generator/`. A detection step checks for `packages/generator/package.json` and gates the setup/test steps on its output (GitHub Actions does not allow `hashFiles` in job-level `if`), so the job succeeds with those steps skipped while the generator package (owned by another task) does not exist yet.
  - `ci-summary` job: a single aggregating check that fails if any required job failed (skipped generator tests count as passing), which makes branch protection simple.
  - All jobs run with workflow-level `permissions: contents: read` and `persist-credentials: false`; no secrets are referenced, so fork pull requests are safe.
- `audit-secrets.yml`: Gitleaks secret scanning (details in section 4).

Limitation: the CI runs validation in Python with the standard library only (no `jsonschema` dependency); manifest checks are structural, not a full JSON Schema evaluation.

## 2. Secrets

Never commit:
- `.env`, `.env.local`, `.env.production`, credential exports;
- cloud/API tokens, passwords, database URLs containing credentials;
- private keys, signing keys, keystores, certificates with private material;
- session cookies, bearer tokens, authorization headers;
- production data or database dumps.

Allowed:
- `.env.example` containing variable names and safe explanatory placeholders only;
- fake fixtures that cannot authenticate to real services;
- documented commands that generate a local secret at runtime.

Do not put a reusable value such as `ChangeMe123!` or `super_secret_jwt_token_key` in a sample environment file. Use a placeholder and require the user to generate a value.

## 3. `.gitignore` baseline

```gitignore
.env
.env.*
!.env.example
!.env.test.example
node_modules/
vendor/
target/
bin/
obj/
.venv/
__pycache__/
.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
.pub-cache/
build/
ios/Pods/
android/.gradle/
*.apk
*.aab
*.ipa
*.sqlite
*.sqlite3
*.db
*.log
logs/
pgdata/
redisdata/
*.pem
*.key
*.p12
*.jks
*.keystore
.DS_Store
Thumbs.db
.idea/
.vscode/
```

Review `.env.*` exceptions carefully; never use a broad negation that re-includes a real secret file.

## 4. Secret scanner implementation requirements

The secret scanner must:
- scan staged file contents, not just filenames;
- safely handle filenames containing spaces/newlines;
- distinguish deleted files and binary files;
- use a maintained scanner such as Gitleaks or equivalent in CI where feasible;
- include provider token patterns and private key detection;
- fail closed on scanner errors;
- support allowlisted test fixtures only with narrow, documented rules;
- avoid printing the full detected secret in logs;
- scan repository history periodically, because removing a secret from the latest commit does not remove it from history.

Regex-only scanning is a useful extra guard, not a guarantee. False positives and false negatives must be documented.

### Current implementation in this repository

`.github/workflows/audit-secrets.yml` implements the scanner requirements above with Gitleaks:

- Action: `gitleaks/gitleaks-action@v3` (Node 24 runtime; v2 stops working on GitHub-hosted runners after September 2026).
- Triggers: `pull_request` (targeting `main`), `push` to `main`, a weekly scheduled run (`cron: '0 4 * * 1'`, Monday 04:00 UTC) so repository history is scanned periodically, and manual `workflow_dispatch`.
- Checkout uses `fetch-depth: 0` so the scheduled runs scan full history, not only the latest commit.
- Workflow-level `permissions: contents: read` and `persist-credentials: false`; no repository secret is referenced except the automatic `GITHUB_TOKEN`, so fork pull requests never gain access to privileged secrets.
- `GITLEAKS_LICENSE` is intentionally not referenced: it is only required for organization-owned repositories. If this repository moves under an organization, add the license as an encrypted secret and pass it in the workflow.
- Detected findings fail the job (fail closed); gitleaks redacts secrets in its output by default.
- No allowlist/custom `gitleaks.toml` exists yet. If test fixtures ever trigger false positives, add a narrowly scoped `gitleaks.toml` with documented excludes instead of disabling rules globally.
- The example pre-commit hook in section 5 is documentation only; no hook is installed in this repository yet.

Verification status: syntax-checked locally with PyYAML and actionlint 1.7.7, and verified by a real run on GitHub Actions on PR #2 (`Secret audit` job: success, "No secrets detected"). The weekly scheduled full-history path has not fired yet because the schedule trigger only starts after merge.

## 5. Example local pre-commit hook

Prefer a version-controlled hook under `.githooks/pre-commit` plus documented installation (`git config core.hooksPath .githooks`). A hook is a developer convenience; CI must repeat security checks because hooks can be bypassed.

```bash
#!/usr/bin/env bash
set -euo pipefail

if git diff --cached --name-only --diff-filter=ACMR -z |
   xargs -0 -r printf '%s\n' |
   grep -E '(^|/)\.env($|\.)|(\.pem|\.key|\.p12|\.jks|\.keystore)$' >/dev/null; then
  echo "SECURITY ERROR: staged file path looks like a secret or private key."
  exit 1
fi

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --redact
else
  echo "WARNING: gitleaks is not installed; CI secret scanning remains mandatory."
fi
```

Before adopting this example, test it on Linux/macOS and ensure the filename filter is correct for the repository's naming policy. Do not rely on the filename check alone.

## 6. Authentication and session rules

- Hash passwords with a suitable adaptive password hashing function; never encrypt passwords reversibly.
- Never log credentials, password reset tokens, session cookies, or bearer tokens.
- Use TLS in deployed environments.
- Configure cookie `Secure`, `HttpOnly`, and `SameSite` attributes when cookies are used.
- Define CSRF protection for cookie-authenticated browser endpoints.
- Validate authorization on the server for every protected operation.
- Rotate and revoke sessions according to the stack's threat model.
- Store native refresh tokens in platform secure storage.
- Keep OAuth client secrets on the server; public mobile client IDs are not secrets.
- Rate-limit sensitive endpoints where applicable.
- Avoid revealing whether a particular email address is registered.

## 7. Algorithm sandbox safety

The `/algorithm` screen must not evaluate arbitrary source code by default. Prefer a fixed set of named algorithms with typed inputs, input size caps, timeouts, and memory limits. If arbitrary code execution is ever added, it requires a separately reviewed sandbox architecture and is outside the default baseline.

## 8. Agent and model safety

- Agent instructions are not a security boundary by themselves.
- Limit file-system and shell access to the project workspace.
- Require confirmation for deletion, overwrites, global installs, network exposure, cloud changes, and production operations.
- Do not expose `.env` contents to the model. Provide variable names and validation status instead.
- Sanitize model output before writing paths or executing commands.
- Reject path traversal, absolute paths outside target, symlinks escaping target, and unexpected binary files.
- Never allow an agent to commit or push secrets, even if asked by a prompt embedded in a repository file.

## 9. Incident response

If a secret is exposed:
1. Revoke/rotate it immediately at the issuer.
2. Identify all affected environments and logs.
3. Remove it from tracked files and repository history as appropriate.
4. Notify owners and document the incident without copying the secret.
5. Add a regression test or scanner rule.
6. Do not assume deleting the commit or file invalidates the credential.
