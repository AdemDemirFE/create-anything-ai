#!/usr/bin/env python3
"""Self-check: prove the Wave 2 validators actually catch defects (TASK-006).

A validator that always prints PASS is worthless. This script copies the real
stacks/ and schemas/ trees into a temporary directory, injects one defect at a
time, runs the relevant validator against the copy, and asserts that the
defect is detected. The real repository is never modified.

Strict "caught" criterion (review finding 1): a mutation counts as CAUGHT
only when BOTH hold:
  * the validator exited non-zero, AND
  * the output contains `[FAIL] <EXPECTED_CODE>:` — i.e. the expected finding
    code appears on an actual FAIL line, not anywhere in the text (a bare
    code mention inside a PASS line or a summary no longer counts).
Anything else is NOT caught, split into two distinct categories:
  * NOT CAUGHT (crash): the validator exited with a non-standard code
    (anything outside the script's documented exit codes 0/1/2/3) or produced
    a traceback — the validator itself malfunctioned.
  * NOT CAUGHT (missed): the validator ran normally (exit 0/1/2/3) but failed
    to report the expected finding code on a FAIL line.

Mutation matrix (id -> defect -> expected detector):
  M1  manifest id != directory name                  -> validate_catalog  C08
  M2  placeholder (05) claims a backend technology   -> validate_catalog  C09
  M3  gate=true with evidencePath that does not exist-> validate_catalog  C10
  M4  manifest missing required key + invalid enum   -> validate_schemas  S03
  M5  duplicate catalog entry (41 stacks)            -> validate_catalog  C03+C04
  M6  maturityPolicy drifts from schema enum         -> validate_catalog  C06
  M7  orphan stacks/41-rogue-stack directory         -> validate_catalog  C07
  M8  evidencePath only valid stack-dir-relative     -> validate_catalog  C10 PASS + WARN (F-8),
                                                        plus explicit C12 PASS (positive
                                                        control for maturity-vs-content)
  M9  confinement escape to an EXISTING outside file -> validate_catalog  C10 (and the same
      + placeholder promoted without content            fixture promotes placeholder content,
                                                        so C12 must fire too)
  M10 corrupt schemas/catalog.schema.json (bad JSON) -> validate_schemas  S05
  M11 absolute evidencePath to an EXISTING outside   -> validate_catalog  C10 ("is an
      file                                                absolute path" reason)
  M12 malformed stacks/<id>/stack.json (invalid JSON)-> validate_schemas  S03

M8 is a positive control, not a defect: it proves the C10 dual-resolution
behaviour documented for finding F-8 — a manifest like PR #7's
("verification.md" relative to the stack directory) must pass with a WARN
naming finding F-8, and the properly promoted stack-01 must also PASS the
C12 maturity-vs-content check. Expected verdict for M8: "PASS-WITH-WARN".

M9 combines the two regression scenarios from the PR #9 review:
  * the evidencePath points at "../../outside/evil.md", and that file is
    CREATED outside the repo root (sibling of the temp copy) — so a
    validator that dropped the confinement check (passthrough
    _evidence_outside_root) would find the file and pass C10; the mutation
    must stay CAUGHT via a literal "[FAIL] C10:" line;
  * the same fixture promotes a stack whose content is still
    placeholder-shaped (requires stays ["to-be-determined"], gates not all
    true), which must produce "[FAIL] C12:".
Both FAIL lines are required, so dropping either check is detected.

M10 corrupts schemas/catalog.schema.json with invalid JSON; the schema
validator must report S05 and exit with a documented code, never crash.
M11 plants an absolute evidencePath (`C:\\...\\absolute-evil.md` /
`/tmp/absolute-evil.md`) whose outside file EXISTS (created before the
validator runs): a validator that dropped the confinement check would
resolve it and pass C10, so the assertion requires "[FAIL] C10:" whose
message states the absolute-path rejection ("is an absolute path").
M12 truncates a stack manifest to invalid JSON; validate_schemas.py must
report "[FAIL] S03: ... invalid JSON" with a documented exit code and no
traceback (the guarded `_load_json` path).

Sensitivity probes (do-nothing stub negative controls): for M9 and M10 the
self-check also runs a stub validator that inspects nothing and always
prints "[FAIL] <code>:" with exit 1. The probe requires
  * the REAL validator to exit 0 on an unmutated copy, and
  * the stub to be rejected by that healthy-tree probe.
If a stub could satisfy a mutation assertion, that assertion would be
vacuous (it cannot distinguish a real check from an always-failing
validator) and the self-check must fail with "sensitivity probe failed".

Usage:
    python tests/integration/selfcheck_mutations.py [--root REPO_ROOT]

Exit codes: 0 = every mutation was caught (and the positive controls plus
sensitivity probes behaved as specified), 1 = at least one mutation was
missed, crashed, or a positive/sensitivity control misbehaved
(validator bug!), 2 = usage/environment error.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Documented exit codes of the validators (see their docstrings / README).
KNOWN_EXIT_CODES = {0, 1, 2, 3}


def prepare_copy(source_root: Path, workdir: Path) -> Path:
    copy_root = workdir / "repo"
    shutil.copytree(source_root / "stacks", copy_root / "stacks")
    shutil.copytree(source_root / "schemas", copy_root / "schemas")
    return copy_root


def run_validator(script: str, root: Path) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, str(HERE / script), "--root", str(root)],
        capture_output=True, text=True, check=False,
    )
    return proc.returncode, proc.stdout + proc.stderr


# --------------------------------------------------------------------------
# Sensitivity probes (anti-vacuous-assertion controls).
#
# For a "must FAIL" mutation to mean anything, the assertion must be able to
# tell a real check from a do-nothing stub that always prints the expected
# FAIL line. The stub below inspects nothing and always emits
# "[FAIL] <CODE>:" with exit 1 (and, for the S05 variant, also "[FAIL] S05:"
# regardless of input). Before each mutation, the REAL validator is run
# against an UNMUTATED copy: if the stub could satisfy the mutation
# assertion, the healthy-tree probe must be able to reject it (exit 0 and
# no "[FAIL] <code>:" line). If the stub survives the healthy tree, the
# mutation assertion would be vacuous and the self-check fails with
# "sensitivity probe failed".
# --------------------------------------------------------------------------
STUB_VALIDATOR = r'''#!/usr/bin/env python3
"""Do-nothing stub used by the mutation self-check sensitivity probes.

Inspects nothing; always prints "[FAIL] <CODE>:" lines with exit 1. If any
mutation assertion accepts this output, that assertion is vacuous.
"""
import argparse
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--root")
args, _ = parser.parse_known_args()
for code in sys.argv[1:]:
    if not code.startswith("--") and len(code) <= 4 and code.isupper():
        print(f"[FAIL] {code}: stub says so (no inspection performed)")
print("RESULT: FAIL")
sys.exit(1)
'''


def write_stub(workdir: Path) -> Path:
    stub = workdir / "stub_validator.py"
    stub.write_text(STUB_VALIDATOR, encoding="utf-8")
    return stub


def run_stub(stub: Path, root: Path, codes: list[str]) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, str(stub), "--root", str(root), *codes],
        capture_output=True, text=True, check=False,
    )
    return proc.returncode, proc.stdout + proc.stderr


def run_healthy_probe(source_root: Path, script: str, codes: list[str],
                      stub: Path) -> str | None:
    """Return a failure message if the sensitivity probe fails, else None.

    The real validator must exit 0 on an unmutated copy (so "[FAIL] <code>:"
    lines never appear for the codes under test), which is exactly the
    output signature the always-failing stub cannot produce.
    """
    probe_root = Path(tempfile.mkdtemp(prefix="qa-probe-"))
    try:
        healthy = prepare_copy(source_root, probe_root)
        code, output = run_validator(script, healthy)
        if code != 0:
            return (f"{script} exited {code} on an UNMUTATED copy; the healthy-tree "
                    f"baseline for the sensitivity probe must be exit 0; tail: "
                    f"...{output[-300:]}")
        leaking = [c for c in codes if f"[FAIL] {c}:" in output]
        if leaking:
            return (f"{script} emits [FAIL] {leaking} on an UNMUTATED copy; a "
                    f"do-nothing stub that always prints those lines could then "
                    f"satisfy the mutation assertion (vacuous)")
        stub_code, stub_out = run_stub(stub, healthy, codes)
        if stub_code == 0 or not any(f"[FAIL] {c}:" in stub_out for c in codes):
            return (f"sensitivity stub unexpectedly behaved like a passing validator "
                    f"(exit {stub_code})")
        return None
    finally:
        shutil.rmtree(probe_root, ignore_errors=True)


def _expected_fail_lines_present(output: str, codes: list[str]) -> list[str]:
    """Return the expected codes missing as literal '[FAIL] <code>:' lines."""
    missing = []
    for code in codes:
        if f"[FAIL] {code}:" not in output:
            missing.append(code)
    return missing


def expect_caught(results: list[tuple[str, int, str]], mutation: str,
                  script: str, codes: list[str],
                  must_contain: str | None = None) -> str:
    for name, code, output in results:
        if name == script:
            if code not in KNOWN_EXIT_CODES or "Traceback (most recent call last)" in output:
                tail = output[-400:] if output else "<no output>"
                return (f"NOT CAUGHT (crash): {script} exited with {code} "
                        f"(expected one of {sorted(KNOWN_EXIT_CODES)}); "
                        f"output tail: ...{tail}")
            missing = _expected_fail_lines_present(output, codes)
            if not missing:
                if must_contain is not None and must_contain not in output:
                    return (f"NOT CAUGHT (missed): {script} produced FAIL lines for {codes} "
                            f"but not for the expected reason ({must_contain!r} absent); "
                            f"output tail: ...{output[-300:]}")
                return f"CAUGHT ({script}, exit {code}, FAIL lines for {codes})"
            if code == 0:
                return (f"NOT CAUGHT (missed): {script} exited 0; expected FAIL lines "
                        f"for {missing} never appeared")
            return (f"NOT CAUGHT (missed): {script} exited {code} for the wrong reason; "
                    f"expected FAIL lines for {missing} never appeared; "
                    f"output tail: ...{output[-300:]}")
    return f"NOT CAUGHT (missed): script {script} never ran"


def expect_pass_with_checks(results: list[tuple[str, int, str]], script: str,
                            warn_code: str | None = None,
                            pass_codes: list[str] | None = None) -> str:
    """Positive control: validator must exit 0 AND emit the given lines.

    Used for M8 (F-8 dual resolution): a stack-dir-relative evidencePath is
    legitimate but must stay visible as a warning, never silently blessed.
    `pass_codes` additionally requires literal "[PASS] <code>:" lines (e.g.
    C12 for the properly promoted stack-01).
    """
    for name, code, output in results:
        if name == script:
            if code != 0:
                tail = output[-400:] if output else "<no output>"
                return (f"NOT CAUGHT (missed): {script} exited {code}; M8 is a valid "
                        f"state and must pass with a warning; output tail: ...{tail}")
            if warn_code is not None and f"[WARN] {warn_code}:" not in output:
                return (f"NOT CAUGHT (missed): {script} exited 0 but did not emit "
                        f"[WARN] {warn_code}: — the F-8 ambiguity would pass silently")
            missing_pass = [c for c in (pass_codes or [])
                            if f"[PASS] {c}:" not in output]
            if missing_pass:
                return (f"NOT CAUGHT (missed): {script} exited 0 but expected PASS "
                        f"lines for {missing_pass} never appeared")
            if "Traceback (most recent call last)" in output:
                return f"NOT CAUGHT (crash): {script} printed a traceback alongside exit 0"
            return (f"PASS-WITH-WARN ({script}, exit 0, [WARN] {warn_code} present"
                    + (f", [PASS] lines for {pass_codes} present" if pass_codes else "")
                    + ")")
    return f"NOT CAUGHT (missed): script {script} never ran"


def run_mutations(source_root: Path) -> list[tuple[str, str, str]]:
    results: list[tuple[str, str, str]] = []

    def fresh() -> Path:
        return prepare_copy(source_root, Path(tempfile.mkdtemp(prefix="qa-mutation-")))

    def edit_json(path: Path, mutate) -> None:
        data = json.loads(path.read_text(encoding="utf-8"))
        mutate(data)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def record(mutation: str, script: str, codes: list[str],
               root: Path, out: tuple[int, str]) -> None:
        results.append((mutation, out[0],
                        expect_caught([(script,) + out], mutation, script, codes)))
        shutil.rmtree(root.parent, ignore_errors=True)

    # M1: id/directory mismatch
    root = fresh()
    p = root / "stacks" / "02-java25-springboot-angular-ionic" / "stack.json"
    edit_json(p, lambda m: m.__setitem__("id", "02-wrong-id"))
    record("M1", "validate_catalog.py", ["C08"], root, run_validator("validate_catalog.py", root))

    # M2: placeholder claims a technology
    root = fresh()
    p = root / "stacks" / "05-nestjs-typeorm-nextjs-reactnative" / "stack.json"
    edit_json(p, lambda m: m.__setitem__("backend", {"language": "TypeScript", "framework": "NestJS"}))
    record("M2", "validate_catalog.py", ["C09"], root, run_validator("validate_catalog.py", root))

    # M3: gate=true with nonexistent evidencePath
    root = fresh()
    p = root / "stacks" / "03-dotnet9-blazor-react-maui" / "stack.json"
    def m3(manifest: dict) -> None:
        manifest["verification"]["manifest"] = True
        manifest["verification"]["evidencePath"] = "stacks/03-dotnet9-blazor-react-maui/verification.md"
    edit_json(p, m3)
    record("M3", "validate_catalog.py", ["C10"], root, run_validator("validate_catalog.py", root))

    # M4: schema-level - missing required key + invalid enum value
    root = fresh()
    p = root / "stacks" / "06-kotlin-ktor-compose-multiplatform" / "stack.json"
    def m4(manifest: dict) -> None:
        del manifest["requires"]
        manifest["maturity"] = "production-ready"
    edit_json(p, m4)
    record("M4", "validate_schemas.py", ["S03"], root, run_validator("validate_schemas.py", root))

    # M5: duplicate catalog entry (41 stacks, duplicate id/number)
    root = fresh()
    p = root / "stacks" / "catalog.json"
    edit_json(p, lambda c: c["stacks"].append(dict(c["stacks"][0])))
    record("M5", "validate_catalog.py", ["C03", "C04"], root, run_validator("validate_catalog.py", root))

    # M6: maturityPolicy drifts from the schema enum
    root = fresh()
    p = root / "stacks" / "catalog.json"
    edit_json(p, lambda c: c["maturityPolicy"].remove("blocked"))
    record("M6", "validate_catalog.py", ["C06"], root, run_validator("validate_catalog.py", root))

    # M7: orphan stack directory outside the catalog
    root = fresh()
    rogue = root / "stacks" / "41-rogue-stack"
    rogue.mkdir()
    (rogue / "stack.json").write_text("{}\n", encoding="utf-8")
    record("M7", "validate_catalog.py", ["C07"], root, run_validator("validate_catalog.py", root))

    # M8 (positive control for finding F-8): evidencePath that only resolves
    # relative to the stack directory (PR #7 convention) must PASS with a
    # WARN, because the file genuinely exists in-repo. Maturity is promoted
    # to 'scaffolded' in BOTH the manifest and the catalog entry (C08 keeps
    # them in sync), mirroring the real PR #7 state. The promotion is backed
    # by real content (requires loses the "to-be-determined" marker and one
    # gate goes true with in-repo evidence), so C12 must also PASS.
    root = fresh()
    p = root / "stacks" / "01-java25-springboot-react-flutter" / "stack.json"
    evidence_file = p.parent / "verification.md"
    evidence_file.write_text("# Verification evidence (stub for M8)\n", encoding="utf-8")

    def m8(manifest: dict) -> None:
        manifest["maturity"] = "scaffolded"
        manifest["requires"] = ["JDK", "Node.js", "Docker"]
        manifest["verification"]["manifest"] = True
        manifest["verification"]["lastVerifiedAt"] = "2026-10-24T17:00:00Z"
        manifest["verification"]["evidencePath"] = "verification.md"
    edit_json(p, m8)
    cat = root / "stacks" / "catalog.json"
    edit_json(cat, lambda c: c["stacks"][0].__setitem__("maturity", "scaffolded"))
    out8 = run_validator("validate_catalog.py", root)
    results.append(("M8", out8[0], expect_pass_with_checks(
        [("validate_catalog.py",) + out8], "validate_catalog.py",
        warn_code="C10", pass_codes=["C12"])))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M9 (review finding 1a): two regressions in one fixture.
    #  (a) evidencePath "../outside/evil.md" where the outside file is
    #      CREATED exactly where the traversal lands (sibling of the temp
    #      copy root) — a validator that dropped the confinement check
    #      (passthrough _evidence_outside_root) would RESOLVE the file and
    #      pass C10, so the mutation must stay CAUGHT via a
    #      "[FAIL] C10:" line whose text states the confinement rejection
    #      ("escapes the repository root"); a mere "does not exist" failure
    #      would not prove the confinement check fired.
    #  (b) the same fixture promotes stack 05 without any content change
    #      (requires keeps "to-be-determined", gates not all true) — must
    #      produce "[FAIL] C12:" (new C12 maturity-vs-content check).
    root = fresh()
    p = root / "stacks" / "03-dotnet9-blazor-react-maui" / "stack.json"

    def m9a(manifest: dict) -> None:
        manifest["verification"]["manifest"] = True
        manifest["verification"]["lastVerifiedAt"] = "2026-10-24T17:00:00Z"
        manifest["verification"]["evidencePath"] = "../outside/evil.md"
    edit_json(p, m9a)
    (root.parent / "outside").mkdir(parents=True, exist_ok=True)
    (root.parent / "outside" / "evil.md").write_text(
        "planted evidence outside the repo\n", encoding="utf-8")

    def m9b(manifest: dict) -> None:
        manifest["maturity"] = "verified"
    edit_json(root / "stacks" / "05-nestjs-typeorm-nextjs-reactnative" / "stack.json", m9b)
    cat = root / "stacks" / "catalog.json"
    edit_json(cat, lambda c: c["stacks"][4].__setitem__("maturity", "verified"))
    out9 = run_validator("validate_catalog.py", root)
    results.append(("M9", out9[0], expect_caught(
        [("validate_catalog.py",) + out9], "M9", "validate_catalog.py",
        ["C10", "C12"], must_contain="escapes the repository root")))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M10 (review finding 1b): corrupt schemas/catalog.schema.json with
    # invalid JSON — the schema validator must report S05 and exit with a
    # documented code, never crash with a traceback.
    root = fresh()
    schema = root / "schemas" / "catalog.schema.json"
    schema.write_text('{"$schema": "http://json-schema.org/draft-2020-12/sc', encoding="utf-8")
    record("M10", "validate_schemas.py", ["S05"], root,
           run_validator("validate_schemas.py", root))

    # M11 (follow-up review): absolute evidencePath pointing OUTSIDE the
    # repo, with the outside file CREATED — dropping the confinement check
    # would let the validator resolve the file and pass, so the assertion
    # requires "[FAIL] C10:" naming the absolute-path rejection. The path
    # is built per-platform (Windows drive letter vs POSIX absolute) and
    # planted OUTSIDE the temp copy root so only confinement can reject it.
    root = fresh()
    p = root / "stacks" / "03-dotnet9-blazor-react-maui" / "stack.json"
    outside_dir = Path(tempfile.mkdtemp(prefix="qa-m11-outside-"))
    outside_file = outside_dir / "absolute-evil.md"
    outside_file.write_text("planted absolute evidence outside the repo\n", encoding="utf-8")

    def m11(manifest: dict) -> None:
        manifest["verification"]["manifest"] = True
        manifest["verification"]["lastVerifiedAt"] = "2026-10-24T17:00:00Z"
        manifest["verification"]["evidencePath"] = str(outside_file)
    edit_json(p, m11)
    out11 = run_validator("validate_catalog.py", root)
    results.append(("M11", out11[0], expect_caught(
        [("validate_catalog.py",) + out11], "M11", "validate_catalog.py",
        ["C10"], must_contain="is an absolute path")))
    shutil.rmtree(root.parent, ignore_errors=True)
    shutil.rmtree(outside_dir, ignore_errors=True)

    # M12 (follow-up review): malformed stack manifest (invalid JSON) —
    # the guarded load path must report "[FAIL] S03: ... invalid JSON"
    # with a documented exit code, never a traceback.
    root = fresh()
    p = root / "stacks" / "06-kotlin-ktor-compose-multiplatform" / "stack.json"
    p.write_text('{"id": "06-kotlin-ktor-compose-multiplatform", "trunc', encoding="utf-8")
    record("M12", "validate_schemas.py", ["S03"], root,
           run_validator("validate_schemas.py", root))

    return results


def main(argv: list[str] | None = None) -> int:
    default_root = HERE.parents[1]
    parser = argparse.ArgumentParser(description="Self-check that the validators catch injected defects.")
    parser.add_argument("--root", type=Path, default=default_root,
                        help="Repository root (default: two levels above this script)")
    args = parser.parse_args(argv)

    if not (args.root / "stacks" / "catalog.json").is_file():
        print(f"ERROR: {args.root} does not look like the repository root.", file=sys.stderr)
        return 2

    print("Validator self-check: mutation testing (Wave 2 / TASK-006)")
    print(f"Repository root (read-only source): {args.root}")
    print("-" * 72)
    stub = write_stub(Path(tempfile.mkdtemp(prefix="qa-stub-")))
    results = run_mutations(args.root)
    failed = False
    for name, _code, verdict in results:
        print(f"{name}: {verdict}")
        if verdict.startswith("NOT CAUGHT"):
            failed = True
    print("-" * 72)
    # Sensitivity probes: could an always-failing do-nothing stub satisfy
    # the M9/M10 assertions? Require the real validators to be clean on an
    # unmutated copy, which the stub can never fake.
    for label, script, codes in (
        ("M9 sensitivity probe", "validate_catalog.py", ["C10", "C12"]),
        ("M10 sensitivity probe", "validate_schemas.py", ["S05"]),
        ("M11 sensitivity probe", "validate_catalog.py", ["C10"]),
        ("M12 sensitivity probe", "validate_schemas.py", ["S03"]),
    ):
        problem = run_healthy_probe(args.root, script, codes, stub)
        print(f"{label}: " + (problem if problem else "OK (healthy tree exit 0, stub rejected)"))
        if problem:
            failed = True
    shutil.rmtree(stub.parent, ignore_errors=True)
    print("-" * 72)
    print("RESULT: PASS (all mutations caught)" if not failed
          else "RESULT: FAIL (validator missed a defect or crashed)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
