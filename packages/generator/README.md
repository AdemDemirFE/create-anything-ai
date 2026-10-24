# @create-anything-ai/generator

Stack catalog CLI for Create Anything AI: list, validate, generate, status.

Zero runtime dependencies. Requires Node.js >= 24.

## Commands

```text
create-anything-ai list
create-anything-ai validate
create-anything-ai status
create-anything-ai generate <stack-id> --output <dir> [--force] [--dry-run]
```

| Command | Description | Exit codes |
| --- | --- | --- |
| `list` | Print all stacks: `NN. <id> [<maturity>] <category>` | 0; 4 on catalog errors |
| `validate` | Validate the catalog: exactly 40 stacks, unique ids, valid maturity | 0; 4 on failures |
| `status` | Print catalog summary (versions, category and maturity counts, next number) | 0; 4 on catalog errors |
| `generate` | Scaffold `README.md`, `stack.json` and empty `docs/ backend/ web/ mobile/` directories | 0; 1 unknown stack; 2 overwrite refused; 3 unsafe path; 64 usage |

Options: `--output <dir>`, `--force`, `--dry-run`, `--catalog <path>`, `--help`, `--version`.

## Safety

- Unknown or malformed stack ids are rejected before any filesystem access (`E_INVALID_STACK`).
- Relative `--output` paths must stay inside the current working directory; filesystem roots, the OS home directory, and the repository root are refused (`E_UNSAFE_PATH`).
- Existing files are never overwritten without `--force`; a re-run without `--force` skips them (idempotent).
- Symlinked output paths are refused (symlink escape protection).
- The CLI never spawns shells or child processes; generated output contains no secrets or credentials.

## Development

```bash
npm test            # runs node --test tests/generator/
npm run generator -- list   # run the CLI from the repo root
```

See `docs/GENERATOR_CONTRACT.md` for the full contract.
