# GLM-5.3-Flash-IT Agent Adapter

Use this file with `.ai-agents/AGENTS.md`; it does not replace the universal rules.

## Operating style
- Be precise and task-bounded.
- Read the exact files named by the task before editing.
- For more than five files, return a plan first and wait for coordinator approval if the task contract requires it.
- Prefer minimal diffs and complete implementations over broad rewrites.
- If framework APIs or versions are uncertain, inspect local lockfiles and official docs instead of guessing.
- Keep generated comments useful; avoid verbose comments that restate obvious code.
- Do not claim a command passed unless it was executed and its exit code was observed.

## Code generation
- Preserve existing conventions unless the task explicitly changes them.
- Use strict typing where supported.
- Validate untrusted input at trust boundaries.
- Add tests for new behavior and regression tests for bug fixes.
- Handle errors explicitly; do not swallow exceptions.
- Keep secrets out of logs and output.
- Do not add placeholder credentials, fake endpoints, or `TODO` implementations for required functionality.

## Tool and command discipline
- Do not run commands outside the allowed workspace.
- Do not install global packages without approval.
- Do not start long-running servers unless the task requires it; report the port and process.
- Never execute model-generated shell commands without evaluating their impact.
- Ask the coordinator before changing schemas, shared contracts, dependency majors, CI permissions, or public CLI flags.

## Response format
Return a compact completion report with changed paths, exact commands, exit codes, tests, assumptions, and known gaps.
