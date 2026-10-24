# Generator CLI Contract

## 1. Purpose

The generator creates a new project directory from a validated stack definition. It must remain useful without an AI provider. AI-assisted code generation is an optional layer, not a dependency for basic scaffolding.

## 2. CLI (implemented in packages/generator)

The catalog commands below are implemented by `packages/generator/bin/create-anything-ai.js` (Node >= 24, zero runtime dependencies):

```text
create-anything-ai list
create-anything-ai validate
create-anything-ai status
create-anything-ai generate <stack-id> --output <dir> [--force] [--dry-run]

Options:
  --output <dir>   Target directory for generate (required)
  --force          Allow overwriting files that already exist in the target
  --dry-run        Print the plan without writing anything
  --catalog <path> Alternative catalog.json path (default: repo stacks/catalog.json)
  --help           Show help
  --version        Print generator version
```

### Command behavior and output formats

- `list` prints one line per stack, in catalog order:
  `NN. <stack-id> [<maturity>] <category>` (e.g. `01. 01-java25-springboot-react-flutter [proposed] enterprise-cross-platform`).
- `validate` prints a summary (`Validated <n> stacks in catalog v<version> (schema <version>)`, category count, maturity counts) and exits non-zero if the catalog violates the rules: exactly 40 stacks, ids matching `^[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$` and unique, maturity one of `proposed | spec-ready | scaffolded | verified | production-reference | blocked`, each entry has integer `number` and non-empty `category`.
- `status` prints: catalog version, stack count, sorted category list, maturity counts, and the next free stack number.
- `generate` derives the human title from the stack id, and writes into the output directory:
  - `README.md` — skeleton description with the derived title, id, category, maturity, and an explicit not-production-ready notice;
  - `stack.json` — manifest template compatible with `schemas/stack-manifest.schema.json` (id, name, category, maturity, description, `requires: []`, `verification` all false/null);
  - empty directories `docs/`, `backend/`, `web/`, `mobile/`.
  - With `--dry-run` it prints the plan and writes nothing. A second run without `--force` skips existing files (idempotent); `--force` overwrites only the tracked skeleton files and never deletes or touches untracked files. Unknown stack ids fail with `E_INVALID_STACK` before anything is written.

Planned, not yet implemented (kept for compatibility with earlier revisions of this contract):

```text
create-anything-ai <target-name> --stack <id>   # interactive/project-name form
  --list-stacks      alias of list
  --with-ai          AI implementation mode (explicit opt-in)
  --provider <name>  Provider adapter, e.g. aihub-glm
```

## 3. Safety rules (implemented behavior)

- Reject unknown stack IDs (`E_INVALID_STACK`, exit 1) before any filesystem access.
- Resolve `--output` to an absolute path. Relative paths must stay inside the current working directory. Filesystem roots, the OS home directory, and the repository root are refused (`E_UNSAFE_PATH`, exit 3).
- Reject path traversal (`..` escaping the allowed root) and refuse to create output under a symlinked path (symlink escape protection, `E_UNSAFE_PATH`).
- Before every planned write (`mkdir` of a skeleton subdirectory, create or `--force` overwrite of a file), every existing component of the planned path is re-checked with `lstat`, walking from the filesystem root down to the target; a symlink planted anywhere on that chain — including above the deepest existing entry, e.g. `--output link/sub/out` with `link` → elsewhere — aborts generation with `E_UNSAFE_PATH` instead of following it. This applies to `--force` overwrites as well.
- Never overwrite an existing file without `--force` (idempotent re-runs skip existing files; `E_TARGET_EXISTS` is reserved for hard conflicts). Untracked files are never touched by `--force`; a symlink at a planned path is refused, never overwritten through.
- `--dry-run` must not create files, start containers, call AI providers, or install packages.
- Do not run package installation or application scripts automatically unless the user explicitly opts in. The CLI never spawns shells or child processes and never interpolates user input into command lines.
- Do not create a production `.env` or invent credentials; generated skeletons contain no secrets.
- Do not write outside the selected target directory except for explicitly documented cache locations.
- Report created / overwritten (`--force`) / skipped files so partial results are visible.
- Return a non-zero exit code on failure (see §7).

## 4. Determinism and provenance

- Skeleton files are produced from pure functions of the catalog entry: same stack id, same bytes (`renderStackJson`, `renderReadme` are deterministic and covered by tests).
- Render only declared variables; there are no free-form template variables yet.
- `.create-anything-ai.json` provenance file is planned but not yet written (future work, see §8).
- No timestamps or personal data are embedded in generated content, keeping snapshot comparisons stable.
- Generated skeletons are always marked not production-ready; maturity claims require the docs/QUALITY_GATES.md evidence.

## 5. AI mode

AI mode must:
1. produce a plan first;
2. validate the plan against `schemas/generation-plan.schema.json`;
3. list proposed files and commands;
4. enforce allowed paths and command policy;
5. require approval for destructive or external actions;
6. apply changes in bounded batches;
7. run validation after each batch;
8. produce an evidence report with passed/failed/skipped checks.

The model must not be trusted to validate its own output. Use ordinary code to validate paths, schema, secrets, and exit codes.

## 6. Environment variables

Provider credentials are supplied through environment variables or a supported secret manager. Do not store API keys in CLI flags, generated files, logs, or shell history. Document the expected names in `docs/GLM_AIHub_SETUP.md`.

## 7. Error codes and exit codes

Implemented by the CLI (stable exit-code mapping in `packages/generator/lib/errors.js`):

| Code | Exit code | Meaning |
| --- | --- | --- |
| `E_INVALID_STACK` | 1 | Unknown or malformed stack id |
| `E_TARGET_EXISTS` | 2 | Reserved: hard target conflict (current overwrites are per-file skip/force) |
| `E_UNSAFE_PATH` | 3 | Path traversal, filesystem root/home/repo-root output, symlink escape |
| `E_CATALOG_INVALID` | 4 | Catalog unreadable or fails content rules (also surfaced as `E_COUNT_MISMATCH`, `E_ID_INVALID`, `E_ID_DUPLICATE`, `E_MATURITY_INVALID`) |
| `E_USAGE` | 64 | Unknown command/option or missing required option |
| `E_IO` | 74 | Unexpected filesystem I/O failure |

Catalog rule violations are additionally distinguishable by message prefix: `E_COUNT_MISMATCH` (stack count ≠ 40), `E_ID_INVALID`, `E_ID_DUPLICATE`, `E_MATURITY_INVALID`.

Reserved for planned features (not yet emitted):

- `E_MANIFEST_INVALID`
- `E_TEMPLATE_MISSING`
- `E_RENDER_FAILED`
- `E_PROVIDER_CONFIG`
- `E_PROVIDER_RATE_LIMIT`
- `E_PROVIDER_UNAVAILABLE`
- `E_VALIDATION_FAILED`
- `E_PERMISSION_DENIED`

Each error prints exactly one `CODE: message` line on stderr — the prefix is added once by `formatError` in `packages/generator/lib/errors.js`, the single source of truth that the CLI entrypoint imports for both formatting and exit-code mapping (unknown or missing codes exit as `E_IO`, 74). Messages carry a safe human-readable text and an actionable next step (e.g. "Run \"create-anything-ai list\" to see available stacks"), never secret values or stack traces by default.

## 8. Known gaps (as of this revision)

- `.create-anything-ai.json` provenance file is not yet written by `generate`.
- AI mode (§5) is not implemented; only catalog + skeleton commands exist.
- No global `npx create-anything-ai` packaging yet; run via `node packages/generator/bin/create-anything-ai.js` or `npm run generator -- <command>`.
