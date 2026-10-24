# Independent QA Integration Validators — Wave 2 (TASK-006)

Reusable, dependency-light validation scripts written by the **independent QA
worker** (TASK-006). Their job is to *independently* verify the merged state of
`main` — the 40-stack catalog, the JSON schemas, the CI configuration — and to
prove the validators themselves work (mutation self-check). They do **not**
reuse worker-2's tests or the inline CI checks; where coverage overlaps, the
scripts re-implement the rule from the contract instead of importing it.

## Scripts

| Script | Purpose |
|---|---|
| `validate_catalog.py` | Catalog integrity (C01–C11): exactly 40 stacks, unique ids/numbers, contiguous 1–40, id/directory agreement, policy membership **and policy↔schema-enum agreement**, placeholder discipline (02–40), verification-evidence reality, stack-01 gate reality. |
| `validate_schemas.py` | Full JSON Schema validation of `stacks/catalog.json` and all 40 `stack.json` manifests via the third-party `jsonschema` package (draft 2020-12), with an offline stdlib fallback engine. |
| `selfcheck_mutations.py` | Mutation testing: injects 7 defects (M1–M7) into a temp copy of `stacks/`/`schemas/` and asserts every one is caught. Proves the validators detect defects rather than always printing PASS. |
| `run_all.py` | Runs the two validators in sequence; `--with-selfcheck` also runs the mutation self-check. |

## How to run

From the repository root (Python 3.12+; developed and verified on 3.13):

```bash
# everything (validators + mutation self-check)
python tests/integration/run_all.py --with-selfcheck

# validators only
python tests/integration/run_all.py

# individually
python tests/integration/validate_catalog.py
python tests/integration/validate_schemas.py
python tests/integration/selfcheck_mutations.py
```

All scripts accept `--root <path>` to validate a different checkout; the
default is the repository root two levels above `tests/integration/`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | All checks passed |
| 1 | One or more checks failed (see `[FAIL]` lines) |
| 2 | Usage/environment error (wrong `--root`, missing files) |
| 3 | `validate_schemas.py` only: schema uses constructs the fallback engine does not support (only when `jsonschema` is absent) |

## Expected output (healthy tree)

`validate_catalog.py` prints one `[PASS]`/`[FAIL]`/`[WARN]` line per finding
(codes C01–C11) and ends with:

```text
Summary: 20 passed, 0 failed, 0 warning(s) across 20 finding(s).
RESULT: PASS
```

`validate_schemas.py` prints findings S00–S03 and ends with:

```text
Summary: 4 passed, 0 failed across 4 finding(s).
RESULT: PASS
```

`selfcheck_mutations.py` prints M1–M7 and ends with:

```text
M1: CAUGHT (validate_catalog.py, exit 1, codes ['C08'])
...
M7: CAUGHT (validate_catalog.py, exit 1, codes ['C07'])
RESULT: PASS (all mutations caught)
```

Any `[FAIL]` line is actionable: it names the stack, the violated rule, and
the observed vs. expected values.

## Dependencies

* `validate_catalog.py`, `selfcheck_mutations.py`, `run_all.py`: **stdlib
  only** (no third-party packages).
* `validate_schemas.py`: prefers the third-party
  [`jsonschema`](https://pypi.org/project/jsonschema/) package (any 4.18+
  release provides `Draft202012Validator` + `referencing.Registry`). This
  environment already ships jsonschema 4.26.0 with Python 3.13, so **no
  installation was required**; the `pip install --user jsonschema` fallback
  from the task contract was therefore not exercised. If `jsonschema` is not
  importable, the script automatically degrades to a stdlib subset validator
  covering exactly the constructs these schemas use and exits with code 3 if
  it meets anything it does not understand (it never silently passes).
  Both engines were exercised and agree on the current data (see
  `docs/validation-report.md`).

## Relationship to other checks

* `.github/workflows/ci.yml` runs its own inline catalog/manifest checks —
  CI is the *enforcement* layer; these scripts are the *independent audit*
  layer and add rules CI does not implement (schema-enum agreement,
  manifest↔catalog agreement, evidence-reality, orphan detection,
  placeholder discipline).
* The generator CLI (PR #4, `feat/generator-cli`) contains its own catalog
  validator with tests. After that PR merges, re-run
  `python tests/integration/run_all.py` — the scripts deliberately do not
  depend on the generator package, so they keep working either way.
* `docs/validation-report.md` records the evidence produced by these scripts.
