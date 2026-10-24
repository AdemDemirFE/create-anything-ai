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
| `validate_catalog.py` | Catalog integrity (C01–C12): exactly 40 stacks, unique ids/numbers, contiguous 1–40, id/directory agreement, policy membership **and policy↔schema-enum agreement**, placeholder discipline (derived from maturity: every `proposed` stack numbered 02–40 must be a bare placeholder; stack 01 is the documented reference exception), verification-evidence reality **with repo-root confinement** (absolute paths and `..` traversal rejected), and the **QUALITY_GATES maturity ladder**: C11 requires gate+evidence claims only from `scaffolded` up (`proposed`/`spec-ready`/`blocked` legitimately carry none), C12 restricts the `to-be-determined` requirement marker to `proposed`/`blocked`. |
| `validate_schemas.py` | Full JSON Schema validation of `stacks/catalog.json` and all 40 `stack.json` manifests via the third-party `jsonschema` package (draft 2020-12), with an offline stdlib fallback engine. Never crashes on bad input: malformed/missing files become `S05` FAIL findings (exit 3), not tracebacks. |
| `selfcheck_mutations.py` | Mutation testing: injects 13 defects (M1–M13) into a temp copy of `stacks/`/`schemas/` and asserts every one is caught with a strict criterion (non-zero exit **and** the expected code on a literal `[FAIL] <CODE>:` line; M9/M11 additionally require the C10 message to state the specific rejection reason). Positive controls: M8 (stack-dir-relative `evidencePath` passes with `[WARN] C10` + `[PASS] C12`), M14 (spec-ready with decided requires and false gates passes), M15 (blocked with the TBD marker passes) — the legitimate gateless maturities must never fail. Anti-vacuous **sensitivity probes** for every must-fail mutation of the confinement/S05/S03/promotion paths (M9–M13): the real validators run on an **unmutated** copy and an always-failing do-nothing stub is proven unable to satisfy the assertions. Crashing validators are reported separately as `NOT CAUGHT (crash)` and also fail the check. Proves the validators detect defects rather than always printing PASS. |
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

`selfcheck_mutations.py` prints M1–M15 and ends with:

```text
M1: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C08'])
...
M7: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C07'])
M8: PASS-WITH-WARN (validate_catalog.py, exit 0, [WARN] C10 present, [PASS] lines for ['C12'] present)
M9: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C10', 'C12'])
M10: CAUGHT (validate_schemas.py, exit 3, FAIL lines for ['S05'])
M11: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C10'])
M12: CAUGHT (validate_schemas.py, exit 1, FAIL lines for ['S03'])
M13: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C11'])
M14: PASS (validate_catalog.py, exit 0, [PASS] lines for ['C11', 'C12'] present)
M15: PASS (validate_catalog.py, exit 0, [PASS] lines for ['C11', 'C12'] present)
M9 sensitivity probe: OK (healthy tree exit 0, stub rejected)
M10 sensitivity probe: OK (healthy tree exit 0, stub rejected)
M11 sensitivity probe: OK (healthy tree exit 0, stub rejected)
M12 sensitivity probe: OK (healthy tree exit 0, stub rejected)
M13 sensitivity probe: OK (healthy tree exit 0, stub rejected)
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
M11 (follow-up review) uses an **absolute** evidencePath to an outside file
that is planted where the path points, and the expected `[FAIL] C10:` must
state "is an absolute path" — dropping the confinement check would resolve
the planted file and pass. M12 (follow-up review) truncates a stack
manifest to invalid JSON and must produce `[FAIL] S03: ... invalid JSON`
with a documented exit code and no traceback. M13 (follow-up review) pins
the ladder-aligned C11: stack 05 claims `scaffolded` in **both** the
manifest and the catalog (so the C08 agreement holds) with invented
backend/web keys and every gate still false — the assertion requires
`[FAIL] C11:` (the C12 TBD-marker layer fires as a second line).
M14/M15 (review round 3) are the **positive controls** for the legitimate
gateless maturities: M14 makes stack 06 `spec-ready` (requires decided,
gates all false, no evidence) and M15 makes stack 09 `blocked` (TBD marker
kept) — both must exit 0 with `[PASS] C11:` and `[PASS] C12:` lines, i.e.
the QUALITY_GATES ladder accepts spec-ready/blocked without gate claims and
only demands gate+evidence from `scaffolded` up.
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
