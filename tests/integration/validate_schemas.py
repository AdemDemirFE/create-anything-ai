#!/usr/bin/env python3
"""Independent JSON Schema validator (Wave 2 / TASK-006).

Validates, independently of worker-2's tests and of the inline CI checks:

  * stacks/catalog.json against schemas/catalog.schema.json
  * every stacks/<id>/stack.json against schemas/stack-manifest.schema.json

Both schemas declare "$schema": "https://json-schema.org/draft/2020-12/schema"
and stack-manifest.schema.json $refs catalog.schema.json#/$defs/*, so the
validator builds a retrieving registry over the repository's schemas/
directory (no network access; the schemas' $id base URI is a reserved
example.invalid domain on purpose).

Cross-file semantic rules that JSON Schema cannot express (exactly 40 stacks,
contiguous numbering, id/directory agreement) are deliberately NOT duplicated
here; they live in validate_catalog.py. This script answers one question:
"does every JSON document satisfy its declared schema, as a third-party
jsonschema implementation sees it?"

Dependency decision (documented per the task contract):
  The task allows `pip install --user jsonschema` OR a stdlib fallback.
  This environment already provides jsonschema 4.26.0 for Python 3.13, so no
  installation is performed. The script degrades gracefully: without
  jsonschema it falls back to a conservative stdlib subset validator that
  covers exactly the constructs used by these two schemas (type, required,
  additionalProperties, properties, items, minItems, uniqueItems, minLength,
  minimum, pattern, enum, const, $ref, $defs, type arrays, description).
  The fallback is also exercised: running the script with `jsonschema` made
  unimportable (e.g. `sys.modules['jsonschema'] = None`) produced the same
  PASS verdict with `engine=stdlib fallback subset validator` (exit code 0);
  both engines agree on the current data. If the schemas ever grow constructs
  the fallback does not know, it refuses to guess and exits with code 3
  ("unsupported schema construct") instead of silently passing.

  Engine probing: `jsonschema` is only used when BOTH `jsonschema` and its
  `referencing` dependency import successfully (jsonschema >= 4.18); an
  incomplete toolchain (e.g. jsonschema 4.17 with no `referencing`) cleanly
  falls back to the stdlib engine instead of crashing with ImportError.

Usage:
    python tests/integration/validate_schemas.py [--root REPO_ROOT]

Exit codes: 0 = all documents valid, 1 = validation failures,
2 = usage/environment error, 3 = schema uses constructs the fallback engine
does not support (only possible when jsonschema is absent).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema"


class Findings:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def check(self, code: str, ok: bool, message: str) -> None:
        self.rows.append(("PASS" if ok else "FAIL", code, message))

    @property
    def failed(self) -> bool:
        return any(level == "FAIL" for level, _, _ in self.rows)

    def render(self) -> str:
        lines = [f"[{level}] {code}: {message}" for level, code, message in self.rows]
        passed = sum(1 for l, _, _ in self.rows if l == "PASS")
        failed = sum(1 for l, _, _ in self.rows if l == "FAIL")
        lines.append("")
        lines.append(f"Summary: {passed} passed, {failed} failed across {len(self.rows)} finding(s).")
        lines.append("RESULT: PASS" if not self.failed else "RESULT: FAIL")
        return "\n".join(lines)


# --------------------------------------------------------------------------
# Primary engine: the third-party `jsonschema` package (draft 2020-12).
# --------------------------------------------------------------------------
def try_load_jsonschema():
    """Return the jsonschema module only if the full toolchain is usable.

    jsonschema >= 4.18 needs the `referencing` package for offline $ref
    resolution; on older jsonschema releases the import of `jsonschema`
    succeeds but `from referencing import ...` raises ImportError (AO review
    inline finding on validate_schemas.py:88). Probe BOTH here so an
    incomplete toolchain cleanly falls back to the stdlib engine instead of
    crashing with a traceback.
    """
    try:
        import jsonschema  # noqa: PLC0415
        from referencing import Registry, Resource  # noqa: F401, PLC0415
        from referencing.jsonschema import DRAFT202012  # noqa: F401, PLC0415
    except ImportError:
        return None
    return jsonschema


def _load_json(path: Path) -> tuple[object | None, str | None]:
    """Read and parse a JSON file; return (data, None) or (None, reason).

    Used everywhere instead of bare json.loads so a malformed/missing file
    becomes a FAIL finding, never an unhandled traceback.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None, "file does not exist"
    except (OSError, UnicodeDecodeError) as exc:
        return None, f"cannot be read: {exc}"
    try:
        return json.loads(text), None
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON: {exc}"


def validate_with_jsonschema(jsonschema, root: Path, findings: Findings) -> bool:
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012

    # Load the two schema files. A schema that cannot be read/parsed is a
    # FAIL finding, never an unhandled crash (fb51 scenario).
    catalog_schema, load_error = _load_json(root / "schemas" / "catalog.schema.json")
    if load_error is not None:
        findings.check("S05", False, f"schemas/catalog.schema.json: {load_error}")
        return False
    manifest_schema_resolved, load_error = _load_json(root / "schemas" / "stack-manifest.schema.json")
    if load_error is not None:
        findings.check("S05", False, f"schemas/stack-manifest.schema.json: {load_error}")
        return False

    # Schema sanity: must be JSON objects, or validation makes no sense.
    for name, schema in (("catalog.schema.json", catalog_schema),
                         ("stack-manifest.schema.json", manifest_schema_resolved)):
        if not isinstance(schema, dict):
            findings.check("S05", False, f"schemas/{name}: root is not a JSON object")
            return False

    OFFLINE_BASE = "https://catalog.schema.local/"

    # Resolve the manifest schema's $ref to catalog.schema.json by *path*
    # substitution onto a synthetic offline URI, then register the catalog
    # schema under that URI in an explicit registry. Validation therefore
    # never touches the network and does not depend on the schemas'
    # placeholder $id base URI (https://example.invalid/...).
    def _rewrite_refs(node):
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("catalog.schema.json#"):
                node["$ref"] = OFFLINE_BASE + "catalog.schema.json#" + ref.split("#", 1)[1]
            for value in node.values():
                _rewrite_refs(value)
        elif isinstance(node, list):
            for value in node:
                _rewrite_refs(value)

    _rewrite_refs(manifest_schema_resolved)
    catalog_schema["$id"] = OFFLINE_BASE + "catalog.schema.json"

    catalog_resource = Resource.from_contents(catalog_schema, default_specification=DRAFT202012)
    registry = Registry().with_resource(OFFLINE_BASE + "catalog.schema.json", catalog_resource)

    Draft202012Validator.check_schema(catalog_schema)
    Draft202012Validator.check_schema(manifest_schema_resolved)

    catalog_validator = Draft202012Validator(catalog_schema, registry=registry)
    manifest_validator = Draft202012Validator(manifest_schema_resolved, registry=registry)

    findings.check("S00", True, "engine=jsonschema 4.x (Draft202012Validator, offline $ref resolution)")

    # catalog.json
    catalog, load_error = _load_json(root / "stacks" / "catalog.json")
    if load_error is not None:
        findings.check("S01", False, f"stacks/catalog.json: {load_error}")
        return False
    errors = sorted(catalog_validator.iter_errors(catalog), key=lambda e: list(e.absolute_path))
    findings.check("S01", not errors,
                   f"stacks/catalog.json vs catalog.schema.json: {len(errors)} error(s)"
                   + ("" if not errors else "; first: " + _fmt_error(errors[0])))

    # manifests
    manifests = sorted((root / "stacks").glob("*/stack.json"))
    findings.check("S02", len(manifests) == 40,
                   f"found {len(manifests)} stack.json manifests, expected 40")
    failures = []
    for path in manifests:
        document, load_error = _load_json(path)
        if load_error is not None:
            failures.append(f"{path.parent.name}/stack.json: {load_error}")
            continue
        errors = sorted(manifest_validator.iter_errors(document), key=lambda e: list(e.absolute_path))
        if errors:
            failures.append(f"{path.parent.name}/stack.json: " + _fmt_error(errors[0]))
    findings.check("S03", not failures,
                   f"all {len(manifests)} manifests valid against stack-manifest.schema.json"
                   if not failures else "; ".join(failures))
    return not findings.failed


def _fmt_error(error) -> str:
    path = "$" + "".join(f"[{p!r}]" if isinstance(p, str) else f"[{p}]" for p in error.absolute_path)
    return f"{path}: {error.message}"


# --------------------------------------------------------------------------
# Fallback engine: stdlib-only subset validator.
# --------------------------------------------------------------------------
class UnsupportedSchema(Exception):
    pass


class SubsetValidator:
    """Minimal draft-2020-12 subset validator; refuses unknown keywords."""

    SUPPORTED = {
        "$schema", "$id", "$ref", "$defs", "title", "description",
        "type", "required", "additionalProperties", "properties",
        "items", "minItems", "uniqueItems", "minLength", "minimum",
        "maximum", "pattern", "enum", "const", "format",
    }
    # Note on "format": in JSON Schema draft 2020-12 "format" is an
    # annotation by default (no format-assertion vocabulary is declared in
    # these schemas), so ignoring it is the spec-correct behavior, not a
    # shortcut.

    def __init__(self, schema: dict, root_uri: str, schemas_dir: Path):
        self.root_uri = root_uri
        self.schemas_dir = schemas_dir
        self.schema = schema

    def _resolve_ref(self, schema: dict, ref: str) -> dict:
        if ref.startswith("#"):
            node = schema
            for part in ref.lstrip("#/").split("/"):
                node = node[part]
            return node
        # Local file ref used by stack-manifest.schema.json -> catalog.schema.json
        m = re.match(r"^([A-Za-z0-9._-]+\.schema\.json)(#.*)?$", ref)
        if m:
            target = self.schemas_dir / m.group(1)
            target_schema = json.loads(target.read_text(encoding="utf-8"))
            if m.group(2):
                return self._resolve_ref(target_schema, m.group(2))
            return target_schema
        raise UnsupportedSchema(f"unsupported $ref: {ref!r}")

    def validate(self, schema: dict, instance, path: str = "$") -> list[str]:
        errors: list[str] = []
        unknown = set(schema) - self.SUPPORTED
        if unknown:
            raise UnsupportedSchema(f"unknown keywords at {path}: {sorted(unknown)}")

        if "$ref" in schema:
            target = self._resolve_ref(self.schema, schema["$ref"])
            return self.validate(target, instance, path)

        if "const" in schema and instance != schema["const"]:
            errors.append(f"{path}: const {schema['const']!r} != {instance!r}")
        if "enum" in schema and instance not in schema["enum"]:
            errors.append(f"{path}: {instance!r} is not one of {schema['enum']!r}")

        expected = schema.get("type")
        if expected is not None:
            expected_types = expected if isinstance(expected, list) else [expected]
            if not any(self._type_ok(t, instance) for t in expected_types):
                errors.append(f"{path}: type {type(instance).__name__} not in {expected_types!r}")
                return errors  # further checks make no sense

        if isinstance(instance, dict):
            props = schema.get("properties", {})
            for key in schema.get("required", []):
                if key not in instance:
                    errors.append(f"{path}: missing required property {key!r}")
            for key, value in instance.items():
                if key in props:
                    errors.extend(self.validate(props[key], value, f"{path}.{key}"))
                else:
                    additional = schema.get("additionalProperties", True)
                    if additional is False:
                        errors.append(f"{path}: additional property {key!r} not allowed")
                    elif isinstance(additional, dict):
                        errors.extend(self.validate(additional, value, f"{path}.{key}"))

        if isinstance(instance, list):
            if "minItems" in schema and len(instance) < schema["minItems"]:
                errors.append(f"{path}: {len(instance)} item(s) < minItems {schema['minItems']}")
            if schema.get("uniqueItems"):
                seen = []
                for item in instance:
                    if item in seen:
                        errors.append(f"{path}: duplicate item {item!r}")
                    seen.append(item)
            items_schema = schema.get("items")
            if isinstance(items_schema, dict):
                for index, item in enumerate(instance):
                    errors.extend(self.validate(items_schema, item, f"{path}[{index}]"))

        if isinstance(instance, str):
            if "minLength" in schema and len(instance) < schema["minLength"]:
                errors.append(f"{path}: length {len(instance)} < minLength {schema['minLength']}")
            if "pattern" in schema and not re.search(schema["pattern"], instance):
                errors.append(f"{path}: {instance!r} does not match pattern {schema['pattern']!r}")

        if isinstance(instance, (int, float)) and not isinstance(instance, bool):
            if "minimum" in schema and instance < schema["minimum"]:
                errors.append(f"{path}: {instance} < minimum {schema['minimum']}")
            if "maximum" in schema and instance > schema["maximum"]:
                errors.append(f"{path}: {instance} > maximum {schema['maximum']}")

        return errors

    @staticmethod
    def _type_ok(expected: str, instance) -> bool:
        if expected == "object":
            return isinstance(instance, dict)
        if expected == "array":
            return isinstance(instance, list)
        if expected == "string":
            return isinstance(instance, str)
        if expected == "integer":
            return isinstance(instance, int) and not isinstance(instance, bool)
        if expected == "number":
            return isinstance(instance, (int, float)) and not isinstance(instance, bool)
        if expected == "boolean":
            return isinstance(instance, bool)
        if expected == "null":
            return instance is None
        raise UnsupportedSchema(f"unsupported type keyword: {expected!r}")


def validate_with_fallback(root: Path, findings: Findings) -> bool:
    catalog_schema, load_error = _load_json(root / "schemas" / "catalog.schema.json")
    if load_error is not None:
        findings.check("S05", False, f"schemas/catalog.schema.json: {load_error}")
        return False
    manifest_schema, load_error = _load_json(root / "schemas" / "stack-manifest.schema.json")
    if load_error is not None:
        findings.check("S05", False, f"schemas/stack-manifest.schema.json: {load_error}")
        return False
    if not isinstance(catalog_schema, dict) or not isinstance(manifest_schema, dict):
        findings.check("S05", False, "schema root is not a JSON object")
        return False
    schemas_dir = root / "schemas"

    catalog_validator = SubsetValidator(catalog_schema, "catalog", schemas_dir)
    manifest_validator = SubsetValidator(manifest_schema, "manifest", schemas_dir)

    findings.check("S00", True, "engine=stdlib fallback subset validator (jsonschema package not available)")

    try:
        catalog, load_error = _load_json(root / "stacks" / "catalog.json")
        if load_error is not None:
            findings.check("S01", False, f"stacks/catalog.json: {load_error}")
            return False
        errors = catalog_validator.validate(catalog_schema, catalog)
        findings.check("S01", not errors,
                       f"stacks/catalog.json vs catalog.schema.json: {len(errors)} error(s)"
                       + ("" if not errors else "; first: " + errors[0]))

        manifests = sorted((root / "stacks").glob("*/stack.json"))
        findings.check("S02", len(manifests) == 40,
                       f"found {len(manifests)} stack.json manifests, expected 40")
        failures = []
        for path in manifests:
            document, load_error = _load_json(path)
            if load_error is not None:
                failures.append(f"{path.parent.name}/stack.json: {load_error}")
                continue
            errors = manifest_validator.validate(manifest_schema, document)
            if errors:
                failures.append(f"{path.parent.name}/stack.json: " + errors[0])
        findings.check("S03", not failures,
                       f"all {len(manifests)} manifests valid against stack-manifest.schema.json"
                       if not failures else "; ".join(failures))
    except UnsupportedSchema as exc:
        # Graceful degradation: the fallback refuses to guess on constructs
        # it does not know. This is a reported, meaningful failure (exit 3),
        # never an unhandled crash.
        findings.check("S04", False, f"fallback engine cannot validate: {exc}")
        return False
    except Exception as exc:  # noqa: BLE001 - last-resort guard: never crash
        findings.check("S05", False, f"fallback engine crashed unexpectedly: {type(exc).__name__}: {exc}")
        return False

    return not findings.failed


def main(argv: list[str] | None = None) -> int:
    default_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Independent JSON Schema validation (Wave 2).")
    parser.add_argument("--root", type=Path, default=default_root,
                        help="Repository root (default: two levels above this script)")
    args = parser.parse_args(argv)

    for required in ("stacks/catalog.json", "schemas/catalog.schema.json", "schemas/stack-manifest.schema.json"):
        if not (args.root / required).is_file():
            print(f"ERROR: {args.root / required} does not exist; run from the repository root "
                  f"or pass --root.", file=sys.stderr)
            return 2

    findings = Findings()
    jsonschema = try_load_jsonschema()
    try:
        if jsonschema is not None:
            ok = validate_with_jsonschema(jsonschema, args.root, findings)
        else:
            ok = validate_with_fallback(args.root, findings)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - last-resort guard: never crash
        findings.check("S05", False,
                       f"validator crashed unexpectedly: {type(exc).__name__}: {exc}")
        ok = False

    print("Independent JSON Schema validation (Wave 2 / TASK-006)")
    print(f"Repository root: {args.root}")
    print("-" * 72)
    print(findings.render())
    if any(code in ("S04", "S05") for _, code, _ in findings.rows):
        # S04: fallback engine hit an unsupported construct (meaningful
        # refusal, exit 3). S05: the validator itself failed to run to
        # completion (environment/schema problem); report as failure, but
        # exit 3 in both cases so callers can distinguish "data invalid"
        # (exit 1) from "validator could not do its job" (exit 3).
        return 3
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
