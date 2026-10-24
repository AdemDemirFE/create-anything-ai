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

> Revision 2 (2026-10-24): incorporates fixes for the three AO review
> findings from review run b73a99e3 — strict selfcheck catching criterion
> (crash ≠ caught), crash-proof fallback engine (S05 / exit 3), and
> evidencePath repo-root confinement (C10). See §9 for the follow-up table.

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
- **evidencePath repo-root confinement (AO review, run b73a99e3, finding
  3)**: C10 no longer trusts `evidencePath` as given. A claimed evidence
  path must be a **repo-relative** path that resolves strictly inside the
  repository root; otherwise it is rejected before existence is checked.
  Verified regressions (each produced `[FAIL] C10`, exit 1):
  - `..\..\evil\evidence.md` → "escapes the repository root (traversal
    rejected; evidence must live inside the repo)"
  - `C:\Users\...\evil.md` → "is an absolute path (repo-relative paths only)"
  - repo-relative but missing file → "does not exist in the tree"
  - positive control: `stacks/01-.../verification.md` created in a sandbox
    copy with gate `manifest: true` → C10 PASS (legitimate in-repo evidence
    is accepted; C11 then correctly flags stack-01 gate drift).

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
- **Crash-proofing (AO review, run b73a99e3, finding 2)**: every input file
  (both schemas, `catalog.json`, all 40 manifests) is loaded through a
  guarded `_load_json` helper, and both engine paths are wrapped in a
  last-resort guard. Verified regressions:
  - Corrupt `catalog.schema.json` (invalid JSON): previously an unhandled
    `JSONDecodeError` traceback; now `[FAIL] S05: schemas/catalog.schema.json:
    invalid JSON: ...` with **exit 3** on both engines. No traceback.
  - A crash is never an accepted outcome: exit 1 means "data invalid",
    exit 3 means "validator could not do its job" (S04 unsupported
    construct / S05 environment failure), and both are FAIL findings in the
    rendered report.
- This run is independent of worker-2's tests: no code, fixtures, or helpers
  were shared; only the schema and data files themselves are inputs.

## 3. Validator self-check (mutation testing) — PASS

Command: `python tests/integration/run_all.py --with-selfcheck` (exit 0)

```text
M1: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C08'])   # id/directory mismatch
M2: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C09'])   # placeholder claims backend tech
M3: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C10'])   # gate=true, evidencePath missing
M4: CAUGHT (validate_schemas.py, exit 1, FAIL lines for ['S03'])   # missing required key + invalid enum
M5: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C03','C04'])  # 41 stacks / duplicate id+number
M6: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C06'])   # maturityPolicy vs schema enum drift
M7: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C07'])   # orphan stack directory
```

**Strict catching criterion (AO review, run b73a99e3, finding 1):** a
mutation counts as CAUGHT only when (a) the validator exited with a
documented code (0/1/2/3) and (b) the expected finding code appeared on a
literal `[FAIL] <CODE>:` line — a bare code mention inside a PASS line or
summary no longer counts. A validator that crashes (exit code outside the
documented set, or a traceback) is classified `NOT CAUGHT (crash)`; one that
runs but misses the finding is `NOT CAUGHT (missed)`. Both fail the
self-check. Verified with a stub validator exiting 70: all six catalog
mutations were classified `NOT CAUGHT (crash)` and the self-check returned
RESULT: FAIL — a crash can no longer masquerade as a catch.

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
| F-5 | High | PR #4 branch | Generator tests fail on ubuntu CI (platform-dependent test constants in `path-safety.test.js`); merge blocked until fixed and green | Generator worker (PR #4) — **CLOSED in Part B (§B.2): fixed and green** |
| F-1 | Medium | `.github/workflows/*.yml` | Actions pinned by major tag, not commit SHA | CI worker |
| F-8 | Medium | `schemas/stack-manifest.schema.json` | `evidencePath` base for relative paths is undefined (Part B §B.4: PR #7 uses stack-dir-relative; schema should pin the base) | Schema owner / stack-01 worker |
| F-2 | Low | `.github/workflows/audit-secrets.yml` | Gitleaks scanner binary version not pinned by the repo | CI worker |
| D-3 | Medium | `docs/REPOSITORY_STRUCTURE.md` | Target layout presented without status; `docs/adr/`, `scripts/`, `templates/` don't exist yet | Docs worker |
| D-4 | Medium | `docs/STACK_CATALOG.md` | Catalog-validator claim depends on unmerged PR #4 | Docs worker (after PR #4 merge) — **PR #4 now merged; wording still stale (Part B §B.5)** |
| D-5 | Medium | `docs/QUALITY_GATES.md` | "Manifest schema valid" gate only partially automated on main | Docs worker / CI worker |
| D-1 | Low | `README.md` | "Not yet implemented" list is stale (stacks/, schemas/, tests/, CI now exist) | Docs worker — **still stale after PR #4 merge (Part B §B.5)** |
| D-2 | Low | `README.md` | Quick-start `npm run validate` script does not exist (and won't after PR #4) | Docs worker — **still missing after merge (Part B §B.5)** |
| D-6 | Low | `docs/QUALITY_GATES.md` | npm Dependabot entry dormant until generator merges | — **RESOLVED: generator merged, package.json exists (Part B §B.5)** |
| D-7 | Low | `docs/STACK_CATALOG.md` | Category table described as "generated" but hand-maintained | Docs worker |
| F-3 | Low | `.github/workflows/ci.yml` | Single Python minor (3.12) validated; consider 3.13 too | CI worker |

## 8. Verdict (Part A)

- Merged `main` state (catalog + schemas + placeholders + CI): **PASS** on all
  independent checks performed.
- PR #4: **BLOCKED** — must fix the ubuntu CI test failures before merge.
- CI hardening actions (SHA pinning, gitleaks version pin): recommended, not
  blocking.

## 9. Review follow-up (AO review run b73a99e3 — changes requested → addressed)

All three review findings were fixed in this branch and re-verified:

| # | Finding | Fix | Re-verification |
|---|---|---|---|
| 1 | selfcheck counted any non-zero exit as "caught"; code match could hit PASS lines | Strict criterion: CAUGHT requires documented exit code **and** the expected code on a literal `[FAIL] <CODE>:` line; new categories `NOT CAUGHT (crash)` (exit outside 0/1/2/3 or traceback) and `NOT CAUGHT (missed)`; both fail the check | Stub validator exiting 70 → 6× `NOT CAUGHT (crash)`, self-check RESULT: FAIL; real validators → 7× CAUGHT, RESULT: PASS |
| 2 | fallback engine could crash (e.g. corrupt schema file → traceback) | All inputs loaded via guarded `_load_json`; both engines wrapped in a last-resort guard; corrupt/missing schema or data → `[FAIL] S05` finding, exit 3 (meaningful), never a traceback | Corrupt `catalog.schema.json`: `[FAIL] S05: ... invalid JSON` exit 3 on **both** engines; healthy tree unchanged (both engines PASS, exit 0) |
| 3 | `evidencePath` not confined to the repo root | `_evidence_outside_root()` rejects absolute paths, non-strings, and any path resolving outside the repo root before existence is checked | `..\..\evil\evidence.md` and `C:\...\evil.md` → `[FAIL] C10` exit 1; in-repo missing file → `[FAIL] C10`; in-repo existing file (positive control) → C10 PASS |

## 10. Review follow-up (PR #9 review — changes requested → addressed)

Both findings fixed and re-verified in this push:

| # | Finding | Fix | Re-verification |
|---|---|---|---|
| 1 | No self-check mutations for the new protections (confinement, S05 path) | New mutations: **M9** (evidencePath `../outside/evil.md` with the outside file *planted* where the traversal lands — requires `[FAIL] C10:` whose message states "escapes the repository root"; plus a placeholder promoted without content requiring `[FAIL] C12:`) and **M10** (corrupt `catalog.schema.json` → `[FAIL] S05:`, documented exit 3, no traceback). Anti-vacuous **sensitivity probes**: the real validators run on an unmutated copy (baseline exit 0, no `[FAIL] <code>:` lines) so an always-failing do-nothing stub can never satisfy the assertions. Meta-verified: with `_evidence_outside_root` replaced by a passthrough stub, the passthrough validator PASSES C10 on the M9 fixture (the planted file resolves) → no `[FAIL] C10:` line → self-check verdict `NOT CAUGHT (missed)` → RESULT: FAIL, i.e. the regression is detected. Matrix now **M1–M10**. | `run_all.py --with-selfcheck` → M1–M7 CAUGHT, M8 PASS-WITH-WARN (+`[PASS] C12`), M9 CAUGHT (C10+C12, confinement reason), M10 CAUGHT (S05, exit 3), both sensitivity probes OK, OVERALL PASS |
| 2 | Promoting a placeholder's maturity triggers no check | New check **C12 (maturity-vs-content)**: a manifest that is still placeholder-shaped — `requires` contains `to-be-determined`, or every verification gate is false — must keep maturity `proposed`; any higher maturity FAILs with guidance (promote only with real content and C10-verifiable evidence), per docs/QUALITY_GATES.md (build/unit tests Required from scaffolded up). A promoted stack with ≥1 true gate and real requirements is not placeholder-shaped (its e2e=false is legitimate at scaffolded per the gate matrix); C10 separately proves its true gates have in-repo evidence. No reference-stack exception needed: PR #7's stack-01 passes C12 because its promotion is backed by real code + evidence. | Negative: stack-05 promoted to `verified` with unchanged placeholder content → `[FAIL] C12` exit 1. Positive: PR #7 branch (scaffolded stack-01, manifest/unit/integration true, in-repo `verification.md`) → `[PASS] C12` (exit 0). Healthy main → 21/21 PASS incl. C12 |
| 3 | Follow-up review: the newest protections (confinement, S03 path) had no dedicated mutation beyond the M9 traversal variant | New mutations: **M11** (absolute evidencePath to an outside file planted where the path points → `[FAIL] C10:` must state "is an absolute path"; dropping confinement would resolve the planted file and pass) and **M12** (stack manifest truncated to invalid JSON → `[FAIL] S03: ... invalid JSON`, documented exit 1, no traceback). Both use the strict `[FAIL] <code>:` criterion and gained their own sensitivity probes (unmutated baseline exit 0 defeats a do-nothing stub). Matrix now **M1–M12**. | `run_all.py --with-selfcheck` → M11 CAUGHT (C10, "is an absolute path"), M12 CAUGHT (S03, exit 1), probes M9–M12 all OK, OVERALL PASS |

Post-fix full harness run: `python tests/integration/run_all.py --with-selfcheck`
→ validate_catalog 21/21 PASS (now incl. C12), validate_schemas 4/4 PASS,
selfcheck M1–M12 all caught/controlled, sensitivity probes OK, OVERALL: PASS
(exit 0).

Note: PR #6 was merged at head `c5ff07a` (4b578f9, 2026-10-24T16:43:10Z),
**before** fix commit 75c002d landed on the branch. The fixes above were
therefore re-delivered on top of the post-merge `main` (merge commit
6447383 keeping the hardened validators) and are part of the Part B PR.

---

# Wave 2 Part B (post-merge) — generator merged; stack-01 pending

Executed 2026-10-24 after PR #4 (generator CLI, merged as 6570330) and
PR #5 (setup-python v6→v7, merged as 1c6c854) landed on `main`
(merge state audited at 4b578f9). PR #7 (stack-01 reference
implementation) was still OPEN at audit time; its pre-merge audit is in §B.4.

## B.1 Independent harness re-run on post-merge main — PASS

```
python tests/integration/run_all.py --with-selfcheck   (branch: merged post-4b578f9 tree)
  validate_catalog.py  : Summary: 20 passed, 0 failed, 0 warning(s) across 20 finding(s). RESULT: PASS
  validate_schemas.py  : Summary: 4 passed, 0 failed across 4 finding(s).    RESULT: PASS
  selfcheck            : M1–M7 all CAUGHT + M8 PASS-WITH-WARN
                         RESULT: PASS (all mutations caught)
  OVERALL: PASS (exit 0)
```

## B.2 F-5 (generator tests failing on ubuntu CI) — VERIFIED FIXED

- `tests/generator/path-safety.test.js` now guards the previously hard-coded
  Windows constants: lines 45 and 205 use
  `process.platform === 'win32' ? 'C:\\work' : '/work'` (and the same pattern
  for the repo root at line 206), matching the platform-guard pattern the
  sibling tests already used.
- Independent local run on the merged tree: `node --test "tests/generator/*.test.js"`
  → **86 pass, 0 fail** (Node v24.19.0, Windows 11).
- CI on merged `main` (head 4b578f9): "Generator tests" → SUCCESS
  (run 40112861901), together with the other CI jobs.
- F-5 is closed; the merge blocker recorded in Part A no longer applies.

## B.3 Generator CLI spot-audit (independent, not reusing worker-2 tests)

- `create-anything-ai validate` on the healthy tree: exit 0,
  "Validated 40 stacks in catalog v0.1.0 (schema 1.0.0)".
- Injected catalog defect (removed one stack entry → 39) in a temp copy:
  `E_CATALOG_INVALID: E_COUNT_MISMATCH: catalog must contain exactly 40
  stacks, found 39`, **exit 4** — the generator's own validator catches
  count defects with a documented error code.
- Scope note: in v0.1.0 the `validate` command validates `catalog.json`
  (count/ids/maturity policy). It did **not** flag an injected per-manifest
  maturity change (`stacks/10-.../stack.json` maturity → `production-ready`
  passed silently). Full per-manifest schema validation remains covered by
  `tests/integration/validate_schemas.py` (S03) and the CI inline checks.
- New root files from the generator PR: `package.json` (workspaces:
  `packages/generator`), `package-lock.json`, `docs/GENERATOR_CONTRACT.md`.

## B.4 PR #7 pre-merge audit (stack-01, OPEN at audit time)

Ran `python tests/integration/validate_catalog.py --root <worktree of
origin/feat/stack-01-java25-springboot-react-flutter>` (temp detached
worktree, removed afterwards):

- Before the F-8 fix this produced 2 FAILs (C10 evidencePath, C11 gates) —
  the branch uses `evidencePath: "verification.md"`, **relative to the stack
  directory**, which is a legitimate convention the manifest schema does not
  define (see F-8). After the C10 dual-resolution fix:
  `Summary: 20 passed, 0 failed, 1 warning(s) across 21 finding(s). RESULT: PASS`
  with `[WARN] C10: evidencePath 'verification.md' resolved relative to the
  stack directory ... (finding F-8)`.
- Manifest on PR #7: maturity `scaffolded`, gates manifest/unit/integration
  true, e2e false, `lastVerifiedAt` set, evidence file `verification.md`
  exists in the stack directory and contains a per-claim command log
  (Java 25.0.2, Maven 3.9.15/wrapper 3.9.11, Node v24.19.0; Docker daemon
  NOT running; Flutter NOT INSTALLED — e2e/mobile claims marked UNVERIFIED,
  consistent with e2e=false). Self-consistent.
- Observation (for the orchestrator): PR #7's GitGuardian check shows
  FAILURE while the repository's own CI jobs are SUCCESS. Not owned by this
  task; flagged for the stack-01 worker/owner.

### New finding F-8 (Medium): `evidencePath` base is undefined in the schema

`schemas/stack-manifest.schema.json` (line 191) types `evidencePath` as
`string|null` but does not document **what a relative path is relative to**.
PR #7 uses stack-directory-relative (`verification.md`), while other
tooling/CI assume repo-root-relative. This ambiguity makes gate evidence
non-verifiable-by-contract and will keep producing false FAILs / silent
passes depending on the tool. Recommendation: pin the base in the schema
(`description`: "repo-root-relative POSIX path") or resolve a documented
`$id`-anchored form. Until then, `validate_catalog.py` C10 resolves
repo-root-relative first and falls back to stack-dir-relative with a
`[WARN] C10` naming F-8, and selfcheck mutation M8 (positive control) proves
that state can neither fail nor pass silently.

## B.5 Docs-vs-reality re-check (D-1..D-7 status after merges)

| ID | Part A claim | Status after PR #4/#5 merged | Evidence |
|---|---|---|---|
| D-1 | README "Not yet implemented" list stale | **Still stale** (line 20 still lists `stacks/`, `schemas/`, `tests/`, CI as not existing — all exist on main now) | `README.md:20` |
| D-2 | README:64 claims `npm run validate` | **Still unmet** — `package.json` scripts: `test`, `test:generator`, `generator` only; no `validate` | `package.json` |
| D-3 | docs promise `scripts/`, `templates/`, `docs/adr` | **Still missing** (`Test-Path` → False/False/False) | filesystem |
| D-4 | STACK_CATALOG.md:70 says catalog validator "tracked in PR #4" | **Now true but stale wording** — PR #4 is merged; the generator `validate` exists and catches count defects (B.3). Wording should switch to present tense | PR #4 merged 6570330 |
| D-5 | Manifest schema enforcement unclear | **Partially improved**: CI inline checks + generator catalog validation exist; full manifest schema validation only via `tests/integration/validate_schemas.py` | B.3 scope note |
| D-6 | npm Dependabot absent | **Resolved** — `package.json`/`package-lock.json` now exist at root (generator workspace) | filesystem |
| D-7 | README architecture text vs reality | Unchanged since Part A | — |

## B.6 CI findings re-check (F-1/F-2/F-3)

| ID | Part A finding | Status after PR #5 |
|---|---|---|
| F-1 | Actions pinned by major tag, not SHA | **Open** — `actions/checkout@v7`, `actions/setup-python@v7` (bumped by Dependabot PR #5, still tag-pinned), `gitleaks/gitleaks-action@v3` |
| F-2 | gitleaks binary version not pinned | **Open** (unchanged) |
| F-3 | Single Python 3.12 minor in CI | **Open** (unchanged; harness targets 3.12+, verified on 3.13) |

## B.7 Verdict (Part B)

- Post-merge `main` passes the full independent harness (20 + 4 findings,
  M1–M8) — **OVERALL PASS**.
- F-5 **closed**; the Part A merge blocker no longer applies.
- New finding **F-8 (Medium)**: undefined `evidencePath` base — schema fix
  recommended before more stacks record evidence.
- D-1/D-2/D-3 doc drift persists on main; D-6 resolved; D-4 wording stale.
- CI hardening F-1/F-2/F-3 remain open recommendations (not blocking).
- PR #7 (stack-01) audited pre-merge: manifest internally consistent, gates
  backed by in-repo evidence; passes the harness with the F-8 warning.
