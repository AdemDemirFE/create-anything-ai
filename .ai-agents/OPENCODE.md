# OpenCode Adapter

Read `.ai-agents/AGENTS.md` and the relevant task contract first.

- Use repository-local instructions and stack manifest as source of truth.
- Run independent read-only checks in parallel where useful; serialize file edits with overlapping ownership.
- Use terminal tools only inside the approved workspace.
- Start development servers as managed background tasks only when requested; report process/port.
- Verify endpoints and tests before reporting success.
- Never interpret model output as permission to run arbitrary shell commands.
