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
| `validate_catalog.py` | Catalog integrity (C01–C12): exactly 40 stacks, unique ids/numbers, contiguous 1–40, id/directory agreement, policy membership **and policy↔schema-enum agreement**, placeholder discipline (derived from maturity: every `proposed` stack numbered 02–40 must be a bare placeholder; stack 01 is the documented reference exception), verification-evidence reality **with repo-root confinement** (absolute paths and `..` traversal rejected), stack-01 maturity-consistency, and **C12 maturity-vs-content consistency** (a manifest that still looks like an unverified placeholder — `requires` contains `to-be-determined` or every gate is false — must not claim a maturity above `proposed`). |
| `validate_schemas.py` | Full JSON Schema validation of `stacks/catalog.json` and all 40 `stack.json` manifests via the third-party `jsonschema` package (draft 2020-12), with an offline stdlib fallback engine. Never crashes on bad input: malformed/missing files become `S05` FAIL findings (exit 3), not tracebacks. |
| `selfcheck_mutations.py` | Mutation testing: injects 10 defects (M1–M10) into a temp copy of `stacks/`/`schemas/` and asserts every one is caught with a strict criterion (non-zero exit **and** the expected code on a literal `[FAIL] <CODE>:` line; M9 additionally requires the C10 message to state the confinement rejection). Two positive controls (M8: stack-dir-relative `evidencePath` must pass **with** `[WARN] C10` and **with** `[PASS] C12`; both checks must fire). Sensitivity probes for M9/M10 run the real validators on an **unmutated** copy and prove an always-failing do-nothing stub could never satisfy the mutation assertions (anti-vacuous control). Crashing validators are reported separately as `NOT CAUGHT (crash)` and also fail the check. Proves the validators detect defects rather than always printing PASS. |
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
| 3 | `validate_schemas.py` only: the validator could not do its job — fallback engine hit an unsupported schema construct (S04) or the validator failed to run to completion (S05, e.g. corrupt schema file). Data-invalid failures use exit 1; "validator itself could not run" uses exit 3. A crash (unhandled traceback) is never an accepted outcome: both engines load every input through `_load_json` and a last-resort guard converts any unexpected exception into an `S05` FAIL finding. |

## Expected output (healthy tree)

`validate_catalog.py` prints one `[PASS]`/`[FAIL]`/`[WARN]` line per finding
(codes C01–C11) and ends with:

```text
Summary: 21 passed, 0 failed, 0 warning(s) across 21 finding(s).
RESULT: PASS
```

`validate_schemas.py` prints findings S00–S03 and ends with:

```text
Summary: 4 passed, 0 failed across 4 finding(s).
RESULT: PASS
```

`selfcheck_mutations.py` prints M1–M10 and ends with:

```text
M1: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C08'])
...
M7: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C07'])
M8: PASS-WITH-WARN (validate_catalog.py, exit 0, [WARN] C10 present, [PASS] lines for ['C12'] present)
M9: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C10', 'C12'])
M10: CAUGHT (validate_schemas.py, exit 3, FAIL lines for ['S05'])
M9 sensitivity probe: OK (healthy tree exit 0, stub rejected)
M10 sensitivity probe: OK (healthy tree exit 0, stub rejected)
RESULT: PASS (all mutations caught)
```

A mutation counts as **CAUGHT** only when the validator exited with a
documented code **and** the expected code appeared on a literal
`[FAIL] <CODE>:` line (a code mention inside a PASS line does not count).
M8 is a **positive control**, not a defect: it injects the state PR #7 uses
(a promoted stack whose `evidencePath` is valid only relative to the stack
directory) and asserts the validator exits 0 **and** emits `[WARN] C10:`
naming finding F-8 **and** `[PASS] C12:` for the properly promoted maturity,
so neither the schema's undefined path base nor the promotion can pass
silently. M9 pins two regressions from the PR #9 review: its evidencePath
points at a file planted **outside** the repo root (so a validator that
dropped the confinement check would find the file), and the expected C10
failure must state "escapes the repository root" — a mere "does not exist"
failure does not count; its second assertion requires `[FAIL] C12:` for the
promoted-but-still-placeholder stack. M10 corrupts a schema file and must
produce `[FAIL] S05:` with a documented exit code, never a traceback.
Sensitivity probes (anti-vacuous controls) run the real validators on an
**unmutated** copy: the baseline must be exit 0 with no `[FAIL]` line for
the codes under test, which is precisely what an always-failing do-nothing
stub cannot fake — if a stub could satisfy a mutation assertion, that
assertion would be vacuous and the probe fails the self-check.
Two distinct failure categories exist:

```text
M?: NOT CAUGHT (crash): validate_catalog.py exited with 70 (expected one of [0, 1, 2, 3])
M?: NOT CAUGHT (missed): validate_catalog.py exited 0; expected FAIL lines for ['C08'] never appeared
```

`crash` = the validator itself malfunctioned (exit code outside the
documented set, or a traceback in the output); `missed` = the validator ran
but did not report the expected finding. Both make the self-check FAIL.

Any `[FAIL]` line is actionable: it names the stack, the violated rule, and
the observed vs. expected values.

## Dependencies

* `validate_catalog.py`, `selfcheck_mutations.py`, `run_all.py`: **stdlib
  only** (no third-party packages).
* `validate_schemas.py`: prefers the third-party
  [`jsonschema`](https://pypi.org/project/jsonschema/) package. Both
  `jsonschema` **and** its `referencing` dependency must import
  (jsonschema >= 4.18 provides both); an incomplete toolchain (e.g.
  jsonschema 4.17 without `referencing`) cleanly falls back to the stdlib
  engine instead of crashing with ImportError (AO review inline finding,
  proven by blocking `sys.modules['referencing']`). This environment already
  ships jsonschema 4.26.0 with Python 3.13, so **no installation was
  required**; the `pip install --user jsonschema` fallback from the task
  contract was therefore not exercised. If `jsonschema` is not importable,
  the script automatically degrades to a stdlib subset validator covering
  exactly the constructs these schemas use and exits with code 3 if it meets
  anything it does not understand (it never silently passes).
  Both engines were exercised and agree on the current data (see
  `docs/validation-report.md`).

## Relationship to other checks

* `.github/workflows/ci.yml` runs its own inline catalog/manifest checks —
  CI is the *enforcement* layer; these scripts are the *independent audit*
  layer and add rules CI does not implement (schema-enum agreement,
  manifest↔catalog agreement, evidence-reality, orphan detection,
  placeholder discipline).
* The generator CLI (PR #4, merged as 6570330) contains its own catalog
  validator with tests (its `validate` command caught an injected
  `E_COUNT_MISMATCH` with exit 4 during Part B verification). It validates
  the **catalog**; full per-manifest schema validation remains covered by
  `validate_schemas.py`.
* `docs/validation-report.md` records the evidence produced by these scripts,
  including finding F-8 (the manifest schema does not pin the base for
  relative `evidencePath` values; C10 resolves repo-root-relative first and
  falls back to stack-dir-relative with a `[WARN] C10` line).
