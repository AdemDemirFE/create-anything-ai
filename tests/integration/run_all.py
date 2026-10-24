#!/usr/bin/env python3
"""Run all Wave 2 integration validators in sequence (TASK-006).

Runs every independent validator in this directory and prints one combined
summary. Individual scripts can still be run directly; see README.md.

Usage:
    python tests/integration/run_all.py [--root REPO_ROOT]

Exit codes: 0 = all validators passed, 1 = at least one validator failed,
2 = usage/environment error.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SCRIPTS = ("validate_catalog.py", "validate_schemas.py")
SELF_CHECK = "selfcheck_mutations.py"


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent
    default_root = here.parents[1]  # here = tests/integration -> parents[1] = repo root
    parser = argparse.ArgumentParser(description="Run all Wave 2 integration validators.")
    parser.add_argument("--root", type=Path, default=default_root,
                        help="Repository root (default: two levels above this script)")
    parser.add_argument("--with-selfcheck", action="store_true",
                        help="Also run selfcheck_mutations.py (mutation testing; slower)")
    args = parser.parse_args(argv)

    results: list[tuple[str, int]] = []
    for script in (*SCRIPTS, *([SELF_CHECK] if args.with_selfcheck else ())):
        script_path = here / script
        if not script_path.is_file():
            print(f"ERROR: {script_path} does not exist.", file=sys.stderr)
            return 2
        print(f"=== {script} ===", flush=True)
        proc = subprocess.run(
            [sys.executable, str(script_path), "--root", str(args.root)],
            check=False,
        )
        results.append((script, proc.returncode))
        print()

    print("=" * 72, flush=True)
    overall_ok = True
    for script, code in results:
        status = "PASS" if code == 0 else f"FAIL (exit {code})"
        if code != 0:
            overall_ok = False
        print(f"{script}: {status}")
    print("OVERALL: PASS" if overall_ok else "OVERALL: FAIL")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
