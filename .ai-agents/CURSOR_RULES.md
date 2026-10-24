# Cursor Project Rules

- Follow `.ai-agents/AGENTS.md` and task-specific instructions.
- TypeScript: enable strict mode when feasible; do not suppress errors with broad `any`.
- Validate all untrusted input at server boundaries.
- Never commit secrets or local environment files.
- Implement accessible responsive UI states: loading, empty, error, success, unauthorized.
- Four-screen requirement: register, login, protected home, and safe algorithm workbench (or documented platform equivalents).
- Keep business logic out of presentation components where the stack supports separation.
- Add or update tests for behavior changes.
- Do not change files outside task scope.
