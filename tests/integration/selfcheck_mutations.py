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
  M8  evidencePath only valid stack-dir-relative     -> validate_catalog  C10 PASS + WARN (F-8)

M8 is a positive control, not a defect: it proves the C10 dual-resolution
behaviour documented for finding F-8 — a manifest like PR #7's
("verification.md" relative to the stack directory) must pass with a WARN
naming finding F-8, while a nonexistent path in either interpretation (M3)
must still FAIL. Expected verdict for M8: "PASS-WITH-WARN".

Usage:
    python tests/integration/selfcheck_mutations.py [--root REPO_ROOT]

Exit codes: 0 = every mutation was caught (and M8 behaved as specified),
1 = at least one mutation was missed, crashed, or M8 misbehaved
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


def _expected_fail_lines_present(output: str, codes: list[str]) -> list[str]:
    """Return the expected codes missing as literal '[FAIL] <code>:' lines."""
    missing = []
    for code in codes:
        if f"[FAIL] {code}:" not in output:
            missing.append(code)
    return missing


def expect_caught(results: list[tuple[str, int, str]], mutation: str,
                  script: str, codes: list[str]) -> str:
    for name, code, output in results:
        if name == script:
            if code not in KNOWN_EXIT_CODES or "Traceback (most recent call last)" in output:
                tail = output[-400:] if output else "<no output>"
                return (f"NOT CAUGHT (crash): {script} exited with {code} "
                        f"(expected one of {sorted(KNOWN_EXIT_CODES)}); "
                        f"output tail: ...{tail}")
            missing = _expected_fail_lines_present(output, codes)
            if not missing:
                return f"CAUGHT ({script}, exit {code}, FAIL lines for {codes})"
            if code == 0:
                return (f"NOT CAUGHT (missed): {script} exited 0; expected FAIL lines "
                        f"for {missing} never appeared")
            return (f"NOT CAUGHT (missed): {script} exited {code} for the wrong reason; "
                    f"expected FAIL lines for {missing} never appeared; "
                    f"output tail: ...{output[-300:]}")
    return f"NOT CAUGHT (missed): script {script} never ran"


def expect_pass_with_warn(results: list[tuple[str, int, str]], script: str,
                          warn_code: str) -> str:
    """Positive control: validator must exit 0 AND emit `[WARN] <code>`.

    Used for M8 (F-8 dual resolution): a stack-dir-relative evidencePath is
    legitimate but must stay visible as a warning, never silently blessed.
    """
    for name, code, output in results:
        if name == script:
            if code != 0:
                tail = output[-400:] if output else "<no output>"
                return (f"NOT CAUGHT (missed): {script} exited {code}; M8 is a valid "
                        f"state and must pass with a warning; output tail: ...{tail}")
            if f"[WARN] {warn_code}:" not in output:
                return (f"NOT CAUGHT (missed): {script} exited 0 but did not emit "
                        f"[WARN] {warn_code}: — the F-8 ambiguity would pass silently")
            if "Traceback (most recent call last)" in output:
                return f"NOT CAUGHT (crash): {script} printed a traceback alongside exit 0"
            return f"PASS-WITH-WARN ({script}, exit 0, [WARN] {warn_code} present)"
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
    # them in sync), mirroring the real PR #7 state.
    root = fresh()
    p = root / "stacks" / "01-java25-springboot-react-flutter" / "stack.json"
    evidence_file = p.parent / "verification.md"
    evidence_file.write_text("# Verification evidence (stub for M8)\n", encoding="utf-8")

    def m8(manifest: dict) -> None:
        manifest["maturity"] = "scaffolded"
        manifest["verification"]["manifest"] = True
        manifest["verification"]["lastVerifiedAt"] = "2026-10-24T17:00:00Z"
        manifest["verification"]["evidencePath"] = "verification.md"
    edit_json(p, m8)
    cat = root / "stacks" / "catalog.json"
    edit_json(cat, lambda c: c["stacks"][0].__setitem__("maturity", "scaffolded"))
    out8 = run_validator("validate_catalog.py", root)
    results.append(("M8", out8[0], expect_pass_with_warn([("validate_catalog.py",) + out8],
                                                         "validate_catalog.py", "C10")))
    shutil.rmtree(root.parent, ignore_errors=True)

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
    results = run_mutations(args.root)
    failed = False
    for name, _code, verdict in results:
        print(f"{name}: {verdict}")
        if verdict.startswith("NOT CAUGHT"):
            failed = True
    print("-" * 72)
    print("RESULT: PASS (all mutations caught)" if not failed
          else "RESULT: FAIL (validator missed a defect or crashed)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
