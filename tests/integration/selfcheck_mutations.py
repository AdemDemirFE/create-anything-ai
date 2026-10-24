#!/usr/bin/env python3
"""Self-check: prove the Wave 2 validators actually catch defects (TASK-006).

A validator that always prints PASS is worthless. This script copies the real
stacks/ and schemas/ trees into a temporary directory, injects one defect at a
time, runs the relevant validator against the copy, and asserts that the
defect is detected (non-zero exit plus the expected finding code in the
output). The real repository is never modified.

Mutation matrix (id -> defect -> expected detector):
  M1  manifest id != directory name                  -> validate_catalog  C08
  M2  placeholder (05) claims a backend technology   -> validate_catalog  C09
  M3  gate=true with evidencePath that does not exist-> validate_catalog  C10
  M4  manifest missing required key + invalid enum   -> validate_schemas  S03
  M5  duplicate catalog entry (41 stacks)            -> validate_catalog  C03+C04
  M6  maturityPolicy drifts from schema enum         -> validate_catalog  C06
  M7  orphan stacks/41-rogue-stack directory         -> validate_catalog  C07

Usage:
    python tests/integration/selfcheck_mutations.py [--root REPO_ROOT]

Exit codes: 0 = every mutation was caught, 1 = at least one mutation was
missed (validator bug!), 2 = usage/environment error.
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


def expect_caught(results: list[tuple[str, int, str]], mutation: str,
                  script: str, codes: list[str]) -> str:
    for name, code, output in results:
        if name == script:
            caught = code != 0 and all(c in output for c in codes)
            if caught:
                return f"CAUGHT ({script}, exit {code}, codes {codes})"
            missing = [c for c in codes if c not in output]
            return (f"MISSED! {script} exit={code}, missing codes {missing}; "
                    f"output tail: ...{output[-300:]}")
    return f"MISSED! script {script} never ran"


def run_mutations(source_root: Path) -> list[tuple[str, str, str]]:
    results: list[tuple[str, str, str]] = []

    def fresh() -> Path:
        return prepare_copy(source_root, Path(tempfile.mkdtemp(prefix="qa-mutation-")))

    def edit_json(path: Path, mutate) -> None:
        data = json.loads(path.read_text(encoding="utf-8"))
        mutate(data)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    # M1: id/directory mismatch
    root = fresh()
    p = root / "stacks" / "02-java25-springboot-angular-ionic" / "stack.json"
    edit_json(p, lambda m: m.__setitem__("id", "02-wrong-id"))
    out = run_validator("validate_catalog.py", root)
    results.append(("M1", out[0], expect_caught([("validate_catalog.py",) + out], "M1", "validate_catalog.py", ["C08"])))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M2: placeholder claims a technology
    root = fresh()
    p = root / "stacks" / "05-nestjs-typeorm-nextjs-reactnative" / "stack.json"
    edit_json(p, lambda m: m.__setitem__("backend", {"language": "TypeScript", "framework": "NestJS"}))
    out = run_validator("validate_catalog.py", root)
    results.append(("M2", out[0], expect_caught([("validate_catalog.py",) + out], "M2", "validate_catalog.py", ["C09"])))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M3: gate=true with nonexistent evidencePath
    root = fresh()
    p = root / "stacks" / "03-dotnet9-blazor-react-maui" / "stack.json"
    def m3(manifest: dict) -> None:
        manifest["verification"]["manifest"] = True
        manifest["verification"]["evidencePath"] = "stacks/03-dotnet9-blazor-react-maui/verification.md"
    edit_json(p, m3)
    out = run_validator("validate_catalog.py", root)
    results.append(("M3", out[0], expect_caught([("validate_catalog.py",) + out], "M3", "validate_catalog.py", ["C10"])))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M4: schema-level - missing required key + invalid enum value
    root = fresh()
    p = root / "stacks" / "06-kotlin-ktor-compose-multiplatform" / "stack.json"
    def m4(manifest: dict) -> None:
        del manifest["requires"]
        manifest["maturity"] = "production-ready"
    edit_json(p, m4)
    out = run_validator("validate_schemas.py", root)
    results.append(("M4", out[0], expect_caught([("validate_schemas.py",) + out], "M4", "validate_schemas.py", ["S03"])))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M5: duplicate catalog entry (41 stacks, duplicate id/number)
    root = fresh()
    p = root / "stacks" / "catalog.json"
    edit_json(p, lambda c: c["stacks"].append(dict(c["stacks"][0])))
    out = run_validator("validate_catalog.py", root)
    results.append(("M5", out[0], expect_caught([("validate_catalog.py",) + out], "M5", "validate_catalog.py", ["C03", "C04"])))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M6: maturityPolicy drifts from the schema enum
    root = fresh()
    p = root / "stacks" / "catalog.json"
    edit_json(p, lambda c: c["maturityPolicy"].remove("blocked"))
    out = run_validator("validate_catalog.py", root)
    results.append(("M6", out[0], expect_caught([("validate_catalog.py",) + out], "M6", "validate_catalog.py", ["C06"])))
    shutil.rmtree(root.parent, ignore_errors=True)

    # M7: orphan stack directory outside the catalog
    root = fresh()
    rogue = root / "stacks" / "41-rogue-stack"
    rogue.mkdir()
    (rogue / "stack.json").write_text("{}\n", encoding="utf-8")
    out = run_validator("validate_catalog.py", root)
    results.append(("M7", out[0], expect_caught([("validate_catalog.py",) + out], "M7", "validate_catalog.py", ["C07"])))
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
        if verdict.startswith("MISSED"):
            failed = True
    print("-" * 72)
    print("RESULT: PASS (all mutations caught)" if not failed else "RESULT: FAIL (validator missed a defect)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
