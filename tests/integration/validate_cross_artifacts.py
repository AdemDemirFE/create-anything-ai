#!/usr/bin/env python3
"""Cross-artifact catalog consistency validator (TASK-026).

Runs the existing Wave-2 validators against the repository and adds one new
cross-artifact check: docs/STACK_CATALOG.md must agree with stacks/catalog.json
(the source of truth) on every stack's maturity.

Complements the inline CI checks in .github/workflows/ci.yml, which verify
catalog structure but not manifest-vs-catalog maturity agreement (the C08
drift class that silently reached main three times) nor documentation drift.

Usage:
    python tests/integration/validate_cross_artifacts.py [--root REPO_ROOT]

Exit codes: 0 = all checks passed, 1 = one or more checks failed,
2 = usage/environment error.

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

SCRIPTS = ("validate_catalog.py", "validate_schemas.py")
DOC_ROW = re.compile(
    r"^\| \d+ \| `([a-z0-9-]+)` \| [a-z0-9-]+ \| `([a-z-]+)` \|", re.M
)


def run_script(script: Path, root: Path) -> int:
    proc = subprocess.run(
        [sys.executable, str(script), "--root", str(root)], check=False
    )
    return proc.returncode


def check_doc_consistency(root: Path) -> list[str]:
    """Return a list of drift findings between the doc matrix and the catalog."""
    catalog_path = root / "stacks" / "catalog.json"
    doc_path = root / "docs" / "STACK_CATALOG.md"

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in catalog.get("stacks", []) if isinstance(s, dict)}

    doc = doc_path.read_text(encoding="utf-8")
    rows = DOC_ROW.findall(doc)

    findings: list[str] = []

    doc_ids = {sid for sid, _ in rows}
    catalog_ids = set(by_id)

    missing_rows = sorted(catalog_ids - doc_ids)
    if missing_rows:
        findings.append(
            "docs/STACK_CATALOG.md is missing rows for catalog stacks: "
            f"{missing_rows}"
        )

    unknown_rows = sorted(doc_ids - catalog_ids)
    if unknown_rows:
        findings.append(
            "docs/STACK_CATALOG.md references ids that are not in the catalog: "
            f"{unknown_rows}"
        )

    for sid, doc_maturity in sorted(rows):
        catalog_maturity = by_id.get(sid, {}).get("maturity")
        if catalog_maturity is not None and catalog_maturity != doc_maturity:
            findings.append(
                f"{sid}: docs/STACK_CATALOG.md says {doc_maturity!r} but "
                f"stacks/catalog.json says {catalog_maturity!r}"
            )

    return findings


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent
    default_root = here.parents[1]
    parser = argparse.ArgumentParser(
        description="Cross-artifact catalog consistency validation (TASK-026)."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=default_root,
        help="Repository root (default: two levels above this script)",
    )
    args = parser.parse_args(argv)

    root = args.root
    catalog_path = root / "stacks" / "catalog.json"
    if not (root / "stacks").is_dir():
        print(f"ERROR: {root} does not look like the repository root "
              f"(no stacks/ directory).", file=sys.stderr)
        return 2

    failures = 0

    # 1. Existing validators (C01-C12 + JSON Schema) on the same tree.
    for script in SCRIPTS:
        script_path = here / script
        if not script_path.is_file():
            print(f"ERROR: {script_path} does not exist.", file=sys.stderr)
            return 2
        print(f"=== {script} ===", flush=True)
        if run_script(script_path, root) != 0:
            failures += 1

    # 2. Doc-vs-catalog maturity consistency (the TASK-020 drift class).
    print("=== doc-vs-catalog consistency ===", flush=True)
    doc_findings: list[str] = []
    if not catalog_path.is_file() or not (root / "docs" / "STACK_CATALOG.md").is_file():
        print("NOTE: catalog or STACK_CATALOG.md absent; doc consistency skipped.")
    else:
        doc_findings = check_doc_consistency(root)
    if doc_findings:
        failures += 1
        for f in doc_findings:
            print(f"[FAIL] D01: {f}")
    else:
        print("[PASS] D01: docs/STACK_CATALOG.md agrees with stacks/catalog.json "
              "on every stack's maturity (rows cover every catalog id).")

    print()
    print("=" * 72, flush=True)
    print("OVERALL: PASS" if failures == 0 else f"OVERALL: FAIL ({failures} check group(s) failed)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
