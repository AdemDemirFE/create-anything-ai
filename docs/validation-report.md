# Validation Report — Independent QA (TASK-006)

This report is produced by the **independent QA worker** (TASK-006, Wave 2).
Its role is to verify — not to repeat — the claims made by other workers, by
running its own scripts in `tests/integration/` against the actual repository
state. Every verdict below is backed by a recorded command and output; nothing
is marked "verified" unless the evidence is in this file.

- Machine: Windows 11 (win32), Python 3.13.2, jsonschema 4.26.0, Node v24.19.0
- Date of Part A: 2026-10-24
- Branch under audit: `main` (as merged: 5be15a6 → 6319fc3 → 0ac62dc → 8f814b8)

---

# Wave 2 Part A (pre-merge)

Scope: what is already merged to `main` (foundation docs, 40-stack catalog +
schemas + placeholder manifests, CI + secret-audit workflows) plus PR #4
(`feat/generator-cli`), which is verified from its branch but is **not yet
merged** — its results must be re-run after merge (see Part B placeholder at
the end of this report).

## 1. Catalog integrity — PASS (20 findings, 0 failed)

Command: `python tests/integration/validate_catalog.py` (exit code 0)

```text
[PASS] C01: stacks/catalog.json parsed as a JSON object
[PASS] C02: schemaVersion is '1.0.0', expected '1.0.0'
[PASS] C02: catalogVersion is '0.1.0', expected semver-like X.Y.Z
[PASS] C03: catalog has 40 stacks, expected 40
[PASS] C04: all stack ids unique
[PASS] C04: all stack numbers unique
[PASS] C05: numbers are exactly 1..40 contiguous
[PASS] C05: all ids match the NN-segment format
[PASS] C05: every id prefix equals its zero-padded number
[PASS] C06: maturityPolicy and categoryPolicy are lists
[PASS] C06: all maturities/categories are members of the catalog policies
[PASS] C06: maturityPolicy [...] vs schema enum [...] (identical)
[PASS] C06: categoryPolicy [...] vs schema enum [...] (identical)
[PASS] C07: all 40 ids have stacks/<id>/stack.json
[PASS] C07: no orphan stack directories outside the catalog
[PASS] C08: all manifests agree with directory name and catalog category/maturity
[PASS] C09: placeholders 02-40 make no technology/platform claims and record no evidence
[PASS] C10: verification state is consistent with recorded evidence (none claimed)
[PASS] C11: stack 01 verification gates {manifest: False, unit: False, integration: False, e2e: False} with no recorded evidence
[PASS] C11: stack 01 is present in the catalog
```

Details checked beyond the raw output:

- **Stack 01 manifest reality**: `stacks/01-java25-springboot-react-flutter/stack.json`
  records `verification` all-`false`, `lastVerifiedAt: null`, `evidencePath:
  null` — this correctly reflects that nothing has been verified yet. The
  manifest *does* declare `backend`/`web`/`mobile`/`data`/`platforms` keys;
  that is allowed because stack 01 is the reference stack and is `proposed`,
  and none of its gates claim success. Its `requires` lists concrete
  prerequisites (JDK, Node.js, Flutter SDK, Docker) — appropriate for a
  reference plan, not a verification claim.
- **Placeholders 02–40**: every one contains only the base fields, `requires:
  ["to-be-determined"]`, `maturity: "proposed"`, all gates `false`, no
  backend/web/mobile/desktop/data/platforms/versions/environment keys — i.e.
  no technology or platform claims, exactly as `docs/STACK_CATALOG.md`
  promises for the placeholder phase.
- **Catalog↔docs agreement**: the category summary counts in
  `docs/STACK_CATALOG.md` (7 baas, 7 enterprise, 8 classic-web, 6 ai-native,
  2 mobile-first, 2 desktop, 2 native, 5 realtime, 1 realtime-3d) match the
  actual catalog contents (independently recomputed).

## 2. Schema validation — PASS (independent engine)

Command: `python tests/integration/validate_schemas.py` (exit code 0)

```text
[PASS] S00: engine=jsonschema 4.x (Draft202012Validator, offline $ref resolution)
[PASS] S01: stacks/catalog.json vs catalog.schema.json: 0 error(s)
[PASS] S02: found 40 stack.json manifests, expected 40
[PASS] S03: all 40 manifests valid against stack-manifest.schema.json
```

- Engine: third-party `jsonschema` **4.26.0** (already present for Python
  3.13; **no installation was needed**, the `pip install --user` fallback was
  not exercised).
- `stack-manifest.schema.json` `$ref`s `catalog.schema.json#/$defs/*`; the
  validator resolves this offline via an explicit `referencing.Registry` —
  network access is never attempted.
- **Fallback engine exercised**: rerunning with `jsonschema` made
  unimportable (`sys.modules['jsonschema'] = None`) produced the same PASS
  verdict via the stdlib subset validator (`engine=stdlib fallback subset
  validator`, exit 0). Both engines agree.
- This run is independent of worker-2's tests: no code, fixtures, or helpers
  were shared; only the schema and data files themselves are inputs.

## 3. Validator self-check (mutation testing) — PASS

Command: `python tests/integration/run_all.py --with-selfcheck` (exit 0)

```text
M1: CAUGHT (validate_catalog.py, exit 1, codes ['C08'])   # id/directory mismatch
M2: CAUGHT (validate_catalog.py, exit 1, codes ['C09'])   # placeholder claims backend tech
M3: CAUGHT (validate_catalog.py, exit 1, codes ['C10'])   # gate=true, evidencePath missing
M4: CAUGHT (validate_schemas.py, exit 1, codes ['S03'])   # missing required key + invalid enum
M5: CAUGHT (validate_catalog.py, exit 1, codes ['C03','C04'])  # 41 stacks / duplicate id+number
M6: CAUGHT (validate_catalog.py, exit 1, codes ['C06'])   # maturityPolicy vs schema enum drift
M7: CAUGHT (validate_catalog.py, exit 1, codes ['C07'])   # orphan stack directory
```

This proves the validators detect defects rather than always printing PASS.

## 4. CI configuration review — findings list

Files reviewed: `.github/workflows/ci.yml`, `.github/workflows/audit-secrets.yml`,
`.github/dependabot.yml` (read-only; not modified, per task scope).

**What is done right (verified):**

| # | Observation | Evidence |
|---|---|---|
| P1 | Both workflows declare top-level `permissions: contents: read` (least privilege) | `ci.yml:11-12`, `audit-secrets.yml:18-19` |
| P2 | `persist-credentials: false` on all checkouts | `ci.yml:30`, `audit-secrets.yml:35` |
| P3 | `pull_request` (to main) + `push` (main) triggers correct; secret audit adds weekly `schedule` cron `0 4 * * 1` + `workflow_dispatch` | `ci.yml:3-7`, `audit-secrets.yml:3-12` |
| P4 | `concurrency` groups with `cancel-in-progress` prevent redundant runs | `ci.yml:14-16`, `audit-secrets.yml:21-23` |
| P5 | No repository secrets referenced (fork-safe `pull_request`) | both workflows |
| P6 | CI degrades gracefully during bootstrap (skips with NOTE when `stacks/`/`schemas/` absent) | `ci.yml:37-51` |
| P7 | Single `ci-summary` required-check job aggregates both jobs incl. skipped generator tests | `ci.yml:269-287` |
| P8 | Secret audit scans full history (`fetch-depth: 0`) | `audit-secrets.yml:34` |

**Findings (issues, none block this QA PR):**

| # | Severity | Finding |
|---|---|---|
| F-1 | **Medium** | Third-party action versions are pinned by **major tag**, not by commit SHA: `actions/checkout@v7`, `actions/setup-python@v6`, `actions/setup-node@v7`, `gitleaks/gitleaks-action@v3`. Tag pinning is vulnerable to tag-retarget/maintenance-mode supply-chain risk. Recommended fix (by the CI worker): pin to full commit SHAs (Dependabot can keep them updated via `github-actions` ecosystem, which is already configured). |
| F-2 | **Low** | **`gitleaks` version is not pinned by the repo itself.** `gitleaks/gitleaks-action@v3` downloads a gitleaks binary at runtime (version determined by the action, not the repository). No explicit `version:` input is set. Note: the task asked "is the gitleaks version pinned?" — it is not (the action tag is major-pinned, the scanner binary version floats). Recommended fix: pass the `version:` input if the action supports it, or accept the documented risk. |
| F-3 | **Low** | CI pins Python `3.12` while the QA worker validated on `3.13` and the repository's own stack catalog targets Python 3.12 for *stacks*. Not an inconsistency in CI itself, but CI exercises only one Python minor. Consider a small matrix (3.12 + 3.13) when validation scripts become part of CI. |
| F-4 | **Low** | `ci.yml` `defaults.run.shell: bash` is set, good for Windows portability, but the workflow only ever runs on `ubuntu-latest`. No cross-OS check exists; the generator test failure in F-5 is exactly the class of bug an `windows-latest` job would have caught. |
| F-5 | **High (in PR #4, not on main)** | See §5: generator tests fail on Ubuntu CI while passing locally on Windows — a platform-dependent test bug in the generator branch. |

## 5. PR #4 (`feat/generator-cli`) — verified from branch, NOT merged

Verification environment: `git worktree add --detach <tmp> origin/feat/generator-cli`
(head 930ba92 "fix: restore generator lockfile for CI cache path"), Node v24.19.0,
Windows. Temporary worktree removed after verification.

**Local test run (Windows): PASS**

```text
node --test "tests/generator/*.test.js"
ℹ tests 80
ℹ suites 25
ℹ pass 80
ℹ fail 0
ℹ duration_ms 4199.3722
```

**CI run on the same head (GitHub Actions, ubuntu-latest, Node 22): FAIL**

```text
CI run 40110449206 (head 930ba92):
  Validate stacks catalog and schemas  SUCCESS
  Generator tests                      FAILURE
  CI summary                           FAILURE
  Gitleaks secret scan                 SUCCESS
```

Root cause (independent diagnosis, from `gh run view --job 120920865533 --log`):

- Failing tests: `tests/generator/path-safety.test.js` →
  `isInsideRoot > 'accepts root itself and nested children'` (line 45) and
  `assertCliOutputPolicy > 'rejects filesystem root, home dir and repo root'`
  (line 183).
- The **library code is platform-correct** (`path.resolve`/`path.relative`);
  the **test constants are Windows-specific without platform guards**:
  `'accepts root itself'` hardcodes `C:\work` (on POSIX,
  `path.relative('/work', resolve('C:\\work'))` yields `..\..\work` → not
  inside → `false !== true`), and `'rejects filesystem root...'` expects
  `assertCliOutputPolicy(path.parse(cwd).root, { cwd })` to throw, but on
  POSIX the sibling path `/C:\work` is *not* a filesystem root, so no
  exception is raised ("Missing expected exception"). Other tests in the
  same file use `onWindows ? 'D:\\elsewhere' : '/elsewhere'` — these two do
  not.
- Classification: **test bug** (POSIX-incompatible test constants), not a
  generator security/logic bug. PR #4 must not merge with CI red; the fix
  belongs to the generator worker (mirror the existing `onWindows ? : `
  pattern or skip-on-POSIX like the symlink tests already do).

**Status for merge gate: BLOCKED on the above CI failure.** (Reported to the
orchestrator; not fixed here — the generator package is outside this task's
owned files.)

## 6. Docs-vs-reality comparison — exaggerated/unmet claims list

Sources compared: `README.md`, `docs/REPOSITORY_STRUCTURE.md`,
`docs/STACK_CATALOG.md`, `docs/QUALITY_GATES.md`,
`docs/IMPLEMENTATION_ROADMAP.md`, `docs/INITIAL_AGENT_BACKLOG.md` against the
actual tree.

Credit first: the docs are unusually honest. The README explicitly says
"Not yet implemented (planned, not existing): stacks/, schemas/, scripts/,
templates/, tests/, CI workflows" — but that sentence itself is now
**stale** (see D-1). Findings:

| # | Severity | Claim (source) | Reality |
|---|---|---|---|
| D-1 | Low | README "Current status" says `stacks/`, `schemas/`, `tests/`, CI workflows are "Not yet implemented (planned, not existing)" (README.md:20) | Those directories **do exist now** (40 stacks, 3 schemas, 2 workflows). The list should be trimmed to `scripts/`, `templates/`, `package.json` (root), and any generated project. |
| D-2 | Low | README "Quick start" shows `npm ci && npm run validate` as if available, with a caveat sentence below (README.md:58-67) | No root `package.json` exists on `main`; the caveat does say so — acceptable but misleading at a glance. It becomes real when PR #4 merges (which adds root `package.json` with `test`/`test:generator`/`generator` scripts — but **no `validate` script**). |
| D-3 | Medium | `docs/REPOSITORY_STRUCTURE.md` root layout lists `docs/adr/` and `scripts/{bootstrap.sh,create-project.js,validate-catalog.js,audit-secrets.sh,glm-generator.js}`, `templates/shared/`, `tests/{generator,manifests,security}`, root `package.json` | None of `docs/adr/`, `scripts/`, `templates/` exist; `tests/` (before this PR) contained nothing; root `package.json` exists only on PR #4's branch. The doc does frame this as a "target contract", and the caption is honest — but it is presented without per-item status, so a reader can mistake it for reality. Suggest a status column or explicit "not yet present" markers. |
| D-4 | Medium | `docs/STACK_CATALOG.md:70` says the structural catalog rules (40 stacks, unique IDs, contiguous numbering, ID/number agreement) "are implemented by the catalog validator (tracked in PR #4, feat: generator CLI with tests)" | True only conditionally: PR #4 is **not merged**, and its CI is red (see §5). Until it merges, that sentence describes a validator that is not part of `main`. The claim is marked as tracked — but it reads as if enforcement already exists. |
| D-5 | Medium | `docs/QUALITY_GATES.md` Gate B claims "Automated today: JSON parsing … and catalog rule validation in CI" and Gate A claims manifest-schema checks | Accurate for the inline CI checks (structure only). However "manifest schema valid" in the Gate matrix is **not** fully automated: CI's manifest check is a structural subset (required keys, id pattern, maturity, verification booleans), while the real `stack-manifest.schema.json` (additionalProperties, patterns, enum refs, version formats) is only enforced by this QA worker's script and (post-merge) the generator. Overstated by omission. |
| D-6 | Low | `docs/QUALITY_GATES.md:47` claims Dependabot monitors `npm` ecosystem for `packages/generator` | Dependabot config exists, but on `main` there is no `packages/generator/` — the npm entry is dormant until PR #4 merges. Dependabot itself documents this as fine; noting for completeness. |
| D-7 | Low | `docs/STACK_CATALOG.md` category table caption says counts "are generated from `stacks/catalog.json` (source of truth)" | The table is hand-maintained, not generated (no generator script exists on main). The *values* currently match (verified in §1) but the "generated" wording overstates the mechanism. |

No doc claims any stack is verified or production-ready — the maturity
discipline (`proposed` everywhere, gates all false) is real and consistent
across catalog, manifests, and docs.

## 7. Open defect list (severity ordered)

| ID | Severity | Where | Defect | Owner suggested |
|---|---|---|---|---|
| F-5 | High | PR #4 branch | Generator tests fail on ubuntu CI (platform-dependent test constants in `path-safety.test.js`); merge blocked until fixed and green | Generator worker (PR #4) |
| F-1 | Medium | `.github/workflows/*.yml` | Actions pinned by major tag, not commit SHA | CI worker |
| F-2 | Low | `.github/workflows/audit-secrets.yml` | Gitleaks scanner binary version not pinned by the repo | CI worker |
| D-3 | Medium | `docs/REPOSITORY_STRUCTURE.md` | Target layout presented without status; `docs/adr/`, `scripts/`, `templates/` don't exist yet | Docs worker |
| D-4 | Medium | `docs/STACK_CATALOG.md` | Catalog-validator claim depends on unmerged PR #4 | Docs worker (after PR #4 merge) |
| D-5 | Medium | `docs/QUALITY_GATES.md` | "Manifest schema valid" gate only partially automated on main | Docs worker / CI worker |
| D-1 | Low | `README.md` | "Not yet implemented" list is stale (stacks/, schemas/, tests/, CI now exist) | Docs worker |
| D-2 | Low | `README.md` | Quick-start `npm run validate` script does not exist (and won't after PR #4) | Docs worker |
| D-6 | Low | `docs/QUALITY_GATES.md` | npm Dependabot entry dormant until generator merges | — (auto-resolves on merge) |
| D-7 | Low | `docs/STACK_CATALOG.md` | Category table described as "generated" but hand-maintained | Docs worker |
| F-3 | Low | `.github/workflows/ci.yml` | Single Python minor (3.12) validated; consider 3.13 too | CI worker |

## 8. Verdict (Part A)

- Merged `main` state (catalog + schemas + placeholders + CI): **PASS** on all
  independent checks performed.
- PR #4: **BLOCKED** — must fix the ubuntu CI test failures before merge.
- CI hardening actions (SHA pinning, gitleaks version pin): recommended, not
  blocking.

---

# Wave 2 Part B (post-merge) — placeholder

To be filled after PR #4 (generator CLI) and the stack-01 worker merge to
`main`:

1. Re-run `python tests/integration/run_all.py --with-selfcheck` on the new
   `main` and record output here.
2. Re-verify F-5 is fixed (generator tests green on ubuntu CI).
3. Check whether D-1..D-7 docs claims were updated post-merge.
4. Re-check CI (SHA pinning F-1/F-2 status).
5. Add stack-01 verification-gate audit (C11 rerun once gates may change).

(Nothing below this line has been executed yet; results must not be claimed.)
