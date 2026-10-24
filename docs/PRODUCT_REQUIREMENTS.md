# Product Requirements — Create Anything AI

## 1. Product definition

Create Anything AI is a developer-focused open-source repository that standardizes how AI coding agents plan, scaffold, implement, test, and document projects across multiple technology stacks.

It is not a promise that one prompt can safely create a fully production-ready system without review. It provides repeatable instructions, stack-specific contracts, generation utilities, and objective quality gates.

## 2. Primary users

- Individual developers starting a new application.
- Engineering teams standardizing internal starter projects.
- AI-agent operators running multi-agent implementation workflows.
- Contributors adding or maintaining stack combinations.
- Reviewers evaluating generated code for security and maintainability.

## 3. Goals

- Maintain a catalog of 40 stack combinations, with explicit maturity and compatibility metadata.
- Offer a consistent project-generation interface.
- Standardize the four-screen user journey where appropriate.
- Provide a secure configuration and secrets workflow.
- Make agent work parallelizable through file ownership and task contracts.
- Verify outputs through deterministic checks, tests, smoke tests, and evidence.
- Keep framework versions, support windows, and compatibility claims auditable.
- Support GLM-5.3-Flash-IT via AIHub without coupling the core repository to one provider.

## 4. Non-goals

- Guarantee that arbitrary generated code is production-ready without human review.
- Automatically deploy to production or mutate cloud resources without approval.
- Commit API keys, passwords, signing keys, real user data, or generated local secrets.
- Force a specific ORM, auth strategy, or database on every stack.
- Execute untrusted generated scripts automatically.
- Claim every stack works on every OS or device without test evidence.
- Train a foundation model as part of the repository.

## 5. Core user journeys

### Journey A — Choose a stack
1. User browses `docs/STACK_CATALOG.md` or runs `--list-stacks`.
2. Tool displays stack ID, short description, maturity, prerequisites, and support status.
3. User chooses a stack and target directory.
4. Tool validates the ID and target path before writing files.

### Journey B — Generate a project
1. Validate the selected manifest against the JSON Schema.
2. Check generator/runtime prerequisites.
3. Copy approved template files to a new target directory.
4. Render only documented variables.
5. Create `.env` from safe defaults only when necessary; never embed real secrets.
6. Print next steps and commands that were actually verified.
7. Record generator version and stack ID in a metadata file.

### Journey C — Implement with AI agents
1. Coordinator reads repository instructions and stack spec.
2. Coordinator creates bounded tasks with dependencies and file ownership.
3. Workers implement isolated areas and report changed files, commands, failures, and assumptions.
4. Security and QA agents review the integrated result.
5. Coordinator resolves conflicts, runs the full gates, and reports evidence.

### Journey D — Contribute a stack
1. Contributor copies the stack specification template.
2. Contributor supplies a manifest and compatibility evidence.
3. Contributor implements the minimal working app and tests.
4. CI validates structure, secrets, manifests, and relevant tests.
5. Stack maturity advances only when the corresponding gate is met.

## 6. Universal four-screen contract

### Register
- Validate email and input length on the server or trusted managed service.
- Hash passwords using a modern password-hashing algorithm when the stack manages credentials.
- Avoid account-enumeration leaks in public responses.
- Enforce unique email at the persistence layer.
- Provide accessible labels and useful validation feedback.

### Login
- Rate-limit authentication attempts where applicable.
- Never log passwords, raw access tokens, session cookies, or authorization headers.
- Document session lifetime, revocation, refresh behavior, and CSRF strategy where relevant.
- Prefer secure, HttpOnly, SameSite cookies for browser sessions where architecture permits.
- For native clients, use platform-appropriate secure storage; do not store secrets in plain preferences.
- Do not claim that JWT is always the best option; select the session model appropriate to the stack.

### Home
- Require authentication at the backend as well as in client routing.
- Display the authenticated profile and safe sample metrics.
- Support logout/session invalidation.
- Provide useful loading, empty, error, and unauthorized states.

### Algorithm workbench
- Accept bounded input and reject oversized or malformed payloads.
- Run algorithms in a safe, bounded context; do not execute arbitrary user-supplied code by default.
- Display output, execution duration, and a human-readable complexity explanation.
- Distinguish measured duration from theoretical Big-O complexity.
- Avoid claiming microsecond precision when the runtime cannot reliably measure it.
- Store execution history only when the stack specification explicitly includes it and privacy rules are documented.

## 7. API response convention

Where a JSON API is used, the default envelope is:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "timestamp": "2026-01-01T12:00:00.000Z",
    "execution_ms": 2.4,
    "request_id": "opaque-correlation-id"
  }
}
```

Rules:
- `data` may be `null` for errors or empty results; define this consistently per API.
- `error` should be a stable object with `code`, safe `message`, and optional field-level details, not merely an arbitrary string.
- `execution_ms` is optional for endpoints where measurement is not useful; do not fabricate it.
- Never return stack traces, SQL details, secrets, or internal infrastructure names to clients.
- Document pagination and validation error formats.
- Avoid wrapping third-party webhooks or standards-based responses if doing so breaks their contract.

Recommended error shape:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "details": [{"field": "email", "code": "INVALID_FORMAT"}]
  },
  "meta": {
    "timestamp": "2026-01-01T12:00:00.000Z",
    "request_id": "opaque-correlation-id"
  }
}
```

## 8. Product success measures

- Clean checkout can validate repository structure.
- Generator rejects unknown stack IDs and unsafe target paths.
- At least one reference stack can be generated and verified end-to-end.
- No known high-severity secret leak or critical vulnerability remains untriaged.
- Each stack has an explicit maturity state and supported-version policy.
- CI results are reproducible and tied to a commit.
- Agent reports distinguish verified facts from assumptions.
