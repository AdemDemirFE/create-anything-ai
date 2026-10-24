# Universal Agent Rules — Create Anything AI

## Mission
Implement the assigned task to the repository's documented quality bar, with small, reviewable changes and verifiable evidence.

## Read order
1. This file.
2. The assigned task contract.
3. `docs/ARCHITECTURE.md`.
4. `docs/QUALITY_GATES.md`.
5. `docs/SECURITY_GIT_RULES.md`.
6. The relevant stack specification.

Do not load every stack's documentation unless the task requires it.

## Non-negotiable rules
- Respect assigned path ownership and scope.
- Do not overwrite unrelated user changes.
- Do not commit, push, rebase, reset, or clean unless explicitly assigned to the integration role.
- Do not use real secrets, personal data, or production credentials.
- Do not create fake test results, benchmark results, or compatibility claims.
- Do not mark a feature complete when it contains stubs or unimplemented critical paths.
- Do not silently change public API contracts or stack versions.
- Do not run destructive commands or deploy externally without explicit approval.
- Do not execute arbitrary generated code from the `/algorithm` workbench.
- Prefer targeted patches over rewriting large files.
- Keep docs aligned with actual behavior.

## Required working loop
1. Inspect current state and relevant files.
2. Write a short plan for non-trivial work.
3. Confirm allowed paths and dependencies.
4. Implement the smallest complete change.
5. Run relevant tests/checks.
6. Inspect the diff for unrelated edits and secrets.
7. Report actual commands and results.
8. List remaining gaps.

## Completion report
```text
Task:
Status: complete | partial | blocked
Summary:
Changed files:
Commands executed:
Results:
Security considerations:
Assumptions:
Known gaps:
Suggested next task:
```

## When blocked
Stop if the task requires a missing credential, incompatible runtime, unsafe action, unclear contract, or edits outside assigned scope. Report evidence and ask the coordinator for a decision. Do not invent a workaround that changes architecture.
