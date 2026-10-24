#!/usr/bin/env python3
"""Independent catalog integrity validator (Wave 2 / TASK-006).

Validates the *reality* of stacks/catalog.json and stacks/<id>/stack.json
without reusing any other worker's test code. This is a sibling of (not a
replacement for) the inline checks in .github/workflows/ci.yml and the
generator CLI's own catalog validator (PR #4): it adds cross-checks CI does
not perform (schema-enum agreement, manifest-vs-catalog agreement, evidence
reality, orphan directory detection, placeholder discipline).

Checks performed
  C01  stacks/catalog.json exists and parses as JSON
  C02  schemaVersion == "1.0.0", catalogVersion is semver-like
  C03  catalog contains exactly 40 stacks
  C04  stack ids unique, stack numbers unique
  C05  numbers are exactly 1..40 (contiguous), id format NN-segments,
       id prefix == zero-padded number
  C06  every maturity/category is a member of the catalog's own policy
       lists, and the policy lists match the enums in
       schemas/catalog.schema.json ($defs) exactly
  C07  every id has stacks/<id>/stack.json; no orphan stack directories
       outside the catalog
  C08  manifest id == directory name; manifest category/maturity agree
       with the catalog entry
  C09  placeholders (numbers 02-40) make no technology/platform claims:
       no backend/web/mobile/desktop/data/platforms/versions/environment
       keys, requires == ["to-be-determined"], maturity "proposed",
       verification gates all false, lastVerifiedAt/evidencePath null
       (placeholder discipline is maturity-gated: it applies while the
       stack is still 'proposed')
  C10  verification reality: any gate that is true must have a non-null
       lastVerifiedAt, a non-null evidencePath, and the evidence file must
       exist in the tree AND resolve inside the repository root (absolute
       paths and ".." traversal are rejected E_UNSAFE-style; applies to all
       stacks, incl. stack 01)
  C11  promotion reality for every non-proposed stack: a 'proposed' stack
        must have all gates false with no recorded evidence; any stack
        whose maturity is above 'proposed' (stack 01 or a promoted 02-40)
        must claim at least one true gate whose evidencePath resolves to
        an existing in-repo file (C10 enforces the details); stack 01
        presence is checked separately
  C12  maturity-vs-content consistency (review finding on PR #9): every
       stack whose manifest still looks like an unverified placeholder
       (requires contains "to-be-determined", or every verification gate is
       still false) must keep maturity "proposed". A maturity above
       "proposed" (scaffolded/verified/...) on placeholder-shaped content
       is an overstatement and FAILs, per docs/QUALITY_GATES.md (build and
       unit tests are "Required" from scaffolded up; a placeholder cannot
       have run them). A promoted stack with at least one true gate and
       real requirements is not placeholder-shaped; C10 separately verifies
       that every true gate has existing in-repo evidence (e.g. PR #7's
       stack-01), and C11 covers stack-01's maturity-vs-gates consistency.

Usage:
    python tests/integration/validate_catalog.py [--root REPO_ROOT]

Exit codes: 0 = all checks passed, 1 = one or more checks failed,
2 = usage/environment error.

Stdlib only: no third-party dependencies are required for this script.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

EXPECTED_STACK_COUNT = 40
ALLOWED_PLATFORMS = {"linux", "macos", "windows", "ios", "android", "web"}
FORBIDDEN_PLACEHOLDER_KEYS = (
    "backend", "web", "mobile", "desktop", "data",
    "platforms", "versions", "environment",
)
PLACEHOLDER_MIN_NUMBER = 2  # numbers >= this are placeholders (01 is the reference stack)
ID_PATTERN = re.compile(r"^[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
SEMVER_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
DERIVED_NAME_WARNING = "derived-name-mismatch"


class Findings:
    """Collects PASS/FAIL/WARN results and renders a stable report."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def check(self, code: str, ok: bool, message: str, ok_message: str | None = None) -> None:
        self.rows.append(("PASS" if ok else "FAIL", code, message if not ok or ok_message is None
                          else ok_message))

    def warn(self, code: str, message: str) -> None:
        self.rows.append(("WARN", code, message))

    @property
    def failed(self) -> bool:
        return any(level == "FAIL" for level, _, _ in self.rows)

    def render(self) -> str:
        lines = []
        for level, code, message in self.rows:
            lines.append(f"[{level}] {code}: {message}")
        passed = sum(1 for l, _, _ in self.rows if l == "PASS")
        warned = sum(1 for l, _, _ in self.rows if l == "WARN")
        failed = sum(1 for l, _, _ in self.rows if l == "FAIL")
        lines.append("")
        lines.append(
            f"Summary: {passed} passed, {failed} failed, {warned} warning(s) "
            f"across {len(self.rows)} finding(s)."
        )
        lines.append(
            "RESULT: PASS" if not self.failed else "RESULT: FAIL"
        )
        return "\n".join(lines)


def load_json(path: Path, findings: Findings, code: str) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        findings.check(code, False, f"{path.as_posix()} does not exist")
        return None
    except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
        findings.check(code, False, f"{path.as_posix()} cannot be read/parsed: {exc}")
        return None
    if not isinstance(data, dict):
        findings.check(code, False, f"{path.as_posix()} root is not a JSON object")
        return None
    return data


def derived_display_name(stack_id: str) -> str:
    """Name a placeholder would get if it were derived from its id."""
    rest = stack_id.split("-", 1)[1]
    return " / ".join(part.capitalize() for part in rest.split("-"))


def _evidence_outside_root(evidence, root: Path) -> str | None:
    """Return a rejection reason if evidencePath escapes the repo root.

    Only repo-relative paths that resolve strictly inside `root` are
    accepted. Returns None when the path is confined (existence itself is
    checked by the caller).
    """
    if not isinstance(evidence, str) or not evidence.strip():
        return "is not a non-empty string"
    candidate = Path(evidence)
    if candidate.is_absolute():
        return "is an absolute path (repo-relative paths only)"
    try:
        resolved = (root / candidate).resolve()
        root_resolved = root.resolve()
    except OSError as exc:  # pragma: no cover - defensive
        return f"cannot be resolved: {exc}"
    if resolved != root_resolved and root_resolved not in resolved.parents:
        return ("escapes the repository root (traversal rejected; "
                "evidence must live inside the repo)")
    return None


def validate(root: Path) -> Findings:
    findings = Findings()

    # --- C01: catalog exists and parses -----------------------------------
    catalog_path = root / "stacks" / "catalog.json"
    catalog = load_json(catalog_path, findings, "C01")
    if catalog is not None:
        findings.check("C01", True, f"{catalog_path.as_posix()} parsed as a JSON object")
    if catalog is None:
        return findings

    # --- C02: version fields ----------------------------------------------
    schema_version = catalog.get("schemaVersion")
    findings.check(
        "C02", schema_version == "1.0.0",
        f"schemaVersion is {schema_version!r}, expected '1.0.0'",
    )
    catalog_version = catalog.get("catalogVersion")
    findings.check(
        "C02",
        isinstance(catalog_version, str) and bool(SEMVER_PATTERN.match(catalog_version)),
        f"catalogVersion is {catalog_version!r}, expected semver-like X.Y.Z",
    )

    # --- C03: exactly 40 stacks -------------------------------------------
    stacks = catalog.get("stacks")
    if not isinstance(stacks, list):
        findings.check("C03", False, f"catalog.stacks is {type(stacks).__name__}, expected list")
        return findings
    findings.check("C03", len(stacks) == EXPECTED_STACK_COUNT,
                   f"catalog has {len(stacks)} stacks, expected {EXPECTED_STACK_COUNT}")

    # --- C04: uniqueness ----------------------------------------------------
    ids = [s.get("id") for s in stacks if isinstance(s, dict)]
    dup_ids = sorted({i for i in ids if ids.count(i) > 1})
    findings.check("C04", not dup_ids, f"duplicate stack ids: {dup_ids}" if dup_ids else "all stack ids unique")
    numbers = [s.get("number") for s in stacks if isinstance(s, dict)]
    dup_numbers = sorted({n for n in numbers if numbers.count(n) > 1})
    findings.check("C04", not dup_numbers,
                   f"duplicate stack numbers: {dup_numbers}" if dup_numbers else "all stack numbers unique")

    # --- C05: contiguous numbering and id/number agreement ------------------
    findings.check("C05", sorted(n for n in numbers if isinstance(n, int) and not isinstance(n, bool))
                   == list(range(1, EXPECTED_STACK_COUNT + 1)),
                   f"numbers are exactly 1..{EXPECTED_STACK_COUNT} contiguous")
    bad_format = [i for i in ids if not isinstance(i, str) or not ID_PATTERN.match(i)]
    findings.check("C05", not bad_format, f"ids violating NN-lowercase format: {bad_format}" if bad_format
                   else "all ids match the NN-segment format")
    by_id = {s.get("id"): s for s in stacks if isinstance(s, dict)}
    prefix_mismatch = [
        f"{sid} (number {by_id[sid].get('number')!r})"
        for sid in ids
        if isinstance(sid, str) and sid[:2].isdigit() and int(sid[:2]) != by_id[sid].get("number")
    ]
    findings.check("C05", not prefix_mismatch,
                   f"id prefix does not match zero-padded number: {prefix_mismatch}" if prefix_mismatch
                   else "every id prefix equals its zero-padded number")

    # --- C06: policy membership + schema enum agreement ---------------------
    maturity_policy = catalog.get("maturityPolicy")
    category_policy = catalog.get("categoryPolicy")
    findings.check("C06", isinstance(maturity_policy, list) and isinstance(category_policy, list),
                   "maturityPolicy and categoryPolicy are lists")
    membership_failures = []
    for s in stacks:
        if not isinstance(s, dict):
            continue
        if s.get("maturity") not in (maturity_policy or []):
            membership_failures.append(f"{s.get('id')}: maturity {s.get('maturity')!r} not in maturityPolicy")
        if s.get("category") not in (category_policy or []):
            membership_failures.append(f"{s.get('id')}: category {s.get('category')!r} not in categoryPolicy")
    findings.check("C06", not membership_failures,
                   "; ".join(membership_failures) if membership_failures
                   else "all maturities/categories are members of the catalog policies")

    # Policy lists must agree with the enums frozen in catalog.schema.json.
    schema_path = root / "schemas" / "catalog.schema.json"
    catalog_schema = load_json(schema_path, findings, "C06")
    if catalog_schema is not None:
        defs = catalog_schema.get("$defs", {})
        schema_maturity = defs.get("maturity", {}).get("enum")
        schema_category = defs.get("category", {}).get("enum")
        findings.check("C06", maturity_policy == schema_maturity,
                       f"maturityPolicy {maturity_policy!r} vs schema enum {schema_maturity!r}")
        findings.check("C06", category_policy == schema_category,
                       f"categoryPolicy {category_policy!r} vs schema enum {schema_category!r}")

    # --- C07: directory coverage and orphan detection -----------------------
    stacks_dir = root / "stacks"
    missing = [sid for sid in ids if not (stacks_dir / str(sid) / "stack.json").is_file()]
    findings.check("C07", not missing,
                   f"missing stacks/<id>/stack.json for: {missing}" if missing
                   else f"all {len(ids)} ids have stacks/<id>/stack.json")
    catalog_ids = set(ids)
    orphans = sorted(
        d.name for d in stacks_dir.iterdir()
        if d.is_dir() and d.name not in catalog_ids
    )
    findings.check("C07", not orphans,
                   f"orphan stack directories not in catalog: {orphans}" if orphans
                   else "no orphan stack directories outside the catalog")

    # --- C08/C09/C10/C11/C12: per-manifest checks ---------------------------
    placeholders_bad: list[str] = []
    evidence_failures: list[str] = []
    identity_failures: list[str] = []
    maturity_mismatches: list[str] = []
    for sid in ids:
        sdir = stacks_dir / str(sid)
        manifest = load_json(sdir / "stack.json", findings, "C07")
        if manifest is None:
            continue
        if manifest.get("id") != sdir.name:
            identity_failures.append(f"{sdir.name}: manifest id {manifest.get('id')!r} != directory name")
        entry = by_id.get(sdir.name, {})
        if manifest.get("category") != entry.get("category"):
            identity_failures.append(
                f"{sdir.name}: manifest category {manifest.get('category')!r} != catalog {entry.get('category')!r}")
        if manifest.get("maturity") != entry.get("maturity"):
            identity_failures.append(
                f"{sdir.name}: manifest maturity {manifest.get('maturity')!r} != catalog {entry.get('maturity')!r}")

        verification = manifest.get("verification")
        if not isinstance(verification, dict):
            evidence_failures.append(f"{sid}: verification object missing/malformed")
        else:
            gates = {k: verification.get(k) for k in ("manifest", "unit", "integration", "e2e")}
            any_true = any(v is True for v in gates.values())
            last_at = verification.get("lastVerifiedAt")
            evidence = verification.get("evidencePath")
            if any_true:
                if last_at is None:
                    evidence_failures.append(f"{sid}: a gate is true but lastVerifiedAt is null")
                if evidence is None:
                    evidence_failures.append(f"{sid}: a gate is true but evidencePath is null")
                else:
                    # Confinement: evidencePath must resolve inside the
                    # repository root. Absolute paths, Windows drive/UNC
                    # forms, and any ".." traversal that escapes the root
                    # are rejected before existence is even checked.
                    #
                    # Resolution base (finding F-8): the manifest schema
                    # does not pin the base for relative evidencePath
                    # values. Try repo-root-relative first (preferred,
                    # unambiguous); if absent, accept a path relative to
                    # the stack directory (the convention PR #7 uses,
                    # e.g. "verification.md") and emit a WARN so the
                    # ambiguity stays visible. Both interpretations are
                    # confinement-checked against the repo root.
                    evidence_reason = _evidence_outside_root(evidence, root)
                    resolved = None
                    if evidence_reason is None and (root / evidence).is_file():
                        resolved = "repo-root"
                    else:
                        stack_rel_reason = _evidence_outside_root(evidence, sdir.parent)
                        if stack_rel_reason is None and (sdir / evidence).is_file():
                            resolved = "stack-dir"
                            findings.warn("C10", f"{sid}: evidencePath {evidence!r} resolved relative to "
                                                 f"the stack directory ({sdir.name}/{evidence}); "
                                                 "repo-root-relative is the preferred convention "
                                                 "(schema does not pin the base — finding F-8)")
                    if evidence_reason is not None:
                        evidence_failures.append(f"{sid}: evidencePath {evidence!r} {evidence_reason}")
                    elif resolved is None:
                        detail = f"does not exist in the tree (tried repo-root-relative {root / evidence}"
                        stack_rel_reason = _evidence_outside_root(evidence, sdir.parent)
                        if stack_rel_reason is None:
                            detail += f" and stack-dir-relative {sdir / evidence})"
                        else:
                            detail += f"; stack-dir-relative {evidence!r} {stack_rel_reason})"
                        evidence_failures.append(f"{sid}: evidencePath {evidence!r} {detail}")

        number = entry.get("number")
        # Placeholder discipline applies to every *placeholder* stack
        # (numbers >= PLACEHOLDER_MIN_NUMBER) whose manifest maturity is
        # still "proposed" (AO review suggestion: derive expectations from
        # maturity rather than hard-coding forever). Stack 01 is the
        # reference stack: it may declare technologies while "proposed"
        # (its acceptance plan lists concrete prerequisites), so its
        # discipline is enforced by C11 instead.
        is_placeholder = (isinstance(number, int) and number >= PLACEHOLDER_MIN_NUMBER
                          and manifest.get("maturity") == "proposed")
        if is_placeholder:
            claimed = [k for k in FORBIDDEN_PLACEHOLDER_KEYS if k in manifest]
            if claimed:
                placeholders_bad.append(f"{sid}: placeholder declares technology/platform keys {claimed}")
            if manifest.get("requires") != ["to-be-determined"]:
                placeholders_bad.append(f"{sid}: placeholder requires {manifest.get('requires')!r}, "
                                        "expected ['to-be-determined']")
            if isinstance(verification, dict):
                gates = [k for k in ("manifest", "unit", "integration", "e2e") if verification.get(k) is not False]
                if gates:
                    placeholders_bad.append(f"{sid}: placeholder verification gates not all false: {gates}")
                if verification.get("lastVerifiedAt") is not None or verification.get("evidencePath") is not None:
                    placeholders_bad.append(f"{sid}: placeholder records verification evidence it cannot have")
            else:
                placeholders_bad.append(f"{sid}: placeholder verification object missing/malformed")
            desc = manifest.get("description", "")
            if not (isinstance(desc, str) and desc.startswith(f"Proposed catalog entry {number:02d}")):
                findings.warn("C09", f"{sid}: description does not follow the placeholder template "
                                     f"('Proposed catalog entry {number:02d} ...')")
            if manifest.get("name") != derived_display_name(str(sid)):
                findings.warn(DERIVED_NAME_WARNING, f"{sid}: name {manifest.get('name')!r} is not the "
                                                    f"id-derived default {derived_display_name(str(sid))!r}")

        # --- C12: maturity-vs-content consistency (review finding) ----------
        # A maturity above "proposed" is a claim that real work happened
        # (docs/QUALITY_GATES.md: build/unit tests are Required from
        # scaffolded up). Content that still looks like an unverified
        # placeholder contradicts that claim, so flag it regardless of
        # which stack it is. Placeholder-shaped means: the manifest still
        # carries the "to-be-determined" requirement marker, or ALL
        # verification gates are still false (no work has been verified at
        # all). A promoted stack with at least one true gate and real
        # requirements (e.g. PR #7's stack-01: scaffolded, manifest/unit/
        # integration true, e2e legitimately false at this rung) is not
        # placeholder-shaped; the truthfulness of its true gates is C10's
        # job (evidence must exist in-repo). Gates that are merely false at
        # a higher maturity rung are legitimate (QUALITY_GATES marks several
        # gates "Planned"/"No" below verified) and are handled by C10/C11.
        if isinstance(verification, dict):
            gate_values = [verification.get(k) for k in ("manifest", "unit", "integration", "e2e")]
            placeholder_shaped = (
                "to-be-determined" in (manifest.get("requires") or [])
                or all(v is False for v in gate_values)
            )
            if placeholder_shaped and manifest.get("maturity") != "proposed":
                maturity_mismatches.append(
                    f"{sid}: maturity {manifest.get('maturity')!r} claims work beyond 'proposed' "
                    "but content is still placeholder-shaped (requires contains "
                    "'to-be-determined' or every verification gate is still false); "
                    "promote only with real content and C10-verifiable evidence")

    findings.check("C08", not identity_failures,
                   "; ".join(identity_failures) if identity_failures
                   else "all manifests agree with directory name and catalog category/maturity")
    findings.check("C09", not placeholders_bad,
                   "; ".join(placeholders_bad) if placeholders_bad
                   else "placeholders 02-40 make no technology/platform claims and record no evidence")
    findings.check("C10", not evidence_failures,
                   "; ".join(evidence_failures) if evidence_failures
                   else "verification state is consistent with recorded evidence (none claimed)")
    findings.check(
        "C12", not maturity_mismatches,
        "; ".join(maturity_mismatches) if maturity_mismatches
        else "manifest maturity matches content shape (no placeholder-shaped manifest above 'proposed')")

    # --- C11: promotion reality for every non-proposed stack -----------------
    # Derive the expectation from maturity (AO review suggestion): a
    # 'proposed' stack must have all gates false and zero evidence; ANY
    # stack whose manifest maturity is above 'proposed' (stack 01 or a
    # promoted 02-40) must claim at least one true gate backed by existing
    # in-repo evidence. Without this, a stack 02-40 promoted in BOTH the
    # manifest and the catalog (so C08 agrees) could carry invented
    # backend/web keys with all gates false and nothing would fail.
    promoted_failures: list[str] = []
    for sid in ids:
        sdir = stacks_dir / str(sid)
        manifest = load_json(sdir / "stack.json", findings, "C07")
        if manifest is None:
            continue
        maturity = manifest.get("maturity")
        verification = manifest.get("verification")
        gates = {k: verification.get(k) for k in ("manifest", "unit", "integration", "e2e")} \
            if isinstance(verification, dict) else {}
        if maturity == "proposed":
            continue
        # stack-01-specific presentation on top of the generic rule
        is_stack01 = str(sid) == "01-java25-springboot-react-flutter"
        label = "stack 01" if is_stack01 else str(sid)
        any_true = any(v is True for v in gates.values())
        if not any_true:
            promoted_failures.append(
                f"{label}: maturity {maturity!r} but every verification gate is false "
                f"(gates {gates}); a promoted stack must claim at least one true gate "
                "whose evidence C10 verifies in-repo")
            continue
        # the claimed evidence must actually resolve (reuse the C10 rule:
        # repo-root-relative, else stack-dir-relative, both confined)
        evidence = verification.get("evidencePath")
        if isinstance(evidence, str) and evidence.strip():
            confined_at_root = _evidence_outside_root(evidence, root) is None \
                and (root / evidence).is_file()
            confined_at_stack = _evidence_outside_root(evidence, sdir.parent) is None \
                and (sdir / evidence).is_file()
            if not (confined_at_root or confined_at_stack):
                promoted_failures.append(
                    f"{label}: maturity {maturity!r} claims gates {gates} but evidencePath "
                    f"{evidence!r} does not resolve to an existing in-repo file")
        else:
            promoted_failures.append(
                f"{label}: maturity {maturity!r} claims gates {gates} but has no usable "
                "evidencePath")
    if promoted_failures:
        findings.check("C11", False, "; ".join(promoted_failures))
    else:
        findings.check(
            "C11", True,
            "every non-proposed stack claims at least one true gate with in-repo evidence "
            "(stack 01 is present in the catalog)")

    # stack-01 presence stays its own finding for continuity with Part A
    stack01 = by_id.get("01-java25-springboot-react-flutter", {})
    findings.check("C11", bool(stack01), "stack 01 is present in the catalog")

    # informative stack-01 note: proposed stacks must not have stray content
    m01 = load_json(stacks_dir / "01-java25-springboot-react-flutter" / "stack.json", findings, "C07")
    if m01 is not None and m01.get("maturity") == "proposed":
        extra_files = sorted(p.name for p in
                             (stacks_dir / "01-java25-springboot-react-flutter").iterdir()
                             if p.name != "stack.json")
        if extra_files:
            findings.warn("C11", f"stack 01 directory contains extra files (fine while "
                                 f"maturity is 'proposed'): {extra_files}")

    return findings


def main(argv: list[str] | None = None) -> int:
    default_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Independent catalog integrity validator (Wave 2).")
    parser.add_argument("--root", type=Path, default=default_root,
                        help="Repository root (default: two levels above this script)")
    args = parser.parse_args(argv)

    if not (args.root / "stacks" / "catalog.json").parent.is_dir():
        print(f"ERROR: {args.root} does not look like the repository root "
              f"(no stacks/ directory).", file=sys.stderr)
        return 2

    findings = validate(args.root)
    print("Independent catalog integrity validation (Wave 2 / TASK-006)")
    print(f"Repository root: {args.root}")
    print("-" * 72)
    print(findings.render())
    return 1 if findings.failed else 0


if __name__ == "__main__":
    sys.exit(main())
