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
| 4 | Follow-up review: gating placeholder checks on maturity removed the old `maturity != proposed` failure; a stack 02–40 promoted in manifest+catalog (C08 agrees) with invented tech keys and all gates false triggered nothing | **C11 generalised** from stack-01-only to every non-proposed stack: any stack with maturity above `proposed` must claim at least one true gate whose evidencePath resolves to an existing in-repo file (same rule C11 applied to stack 01), else `[FAIL] C11`; C12 adds a second layer (placeholder-shaped content must stay `proposed`). Stack-01 presence stays its own finding. New mutation **M13**: stack 05 promoted in both manifest and catalog with invented backend/web keys and all gates false → `[FAIL] C11` (+ `[FAIL] C12`), with its own sensitivity probe. Matrix now **M1–M13**. Meta-verified: with C11 pinned back to stack-01-only, M13 loses its `[FAIL] C11:` line → verdict NOT CAUGHT → regression detected. | `run_all.py --with-selfcheck` → M13 CAUGHT (C11), probe OK, OVERALL PASS; healthy main 21/21 PASS; PR #7 branch (scaffolded stack-01 with true gates + in-repo evidence) still PASS |
| 5 | Review round 3: C11/C12 failed legitimate stacks — a `spec-ready` stack (documentation ready, build/unit "Planned") and a `blocked` stack (conscious stop) legitimately keep all gates false with no evidence, but the "every non-proposed stack needs a true gate" rule and the all-gates-false arm of C12 flagged them | **C11/C12 aligned with the docs/QUALITY_GATES.md maturity ladder**: C11 demands gate+evidence only from `scaffolded` up (`proposed`/`spec-ready`/`blocked` carry no gate claims by design); C12 keeps only the TBD-marker arm (`requires` containing `to-be-determined` may only be `proposed` or `blocked`) — the all-gates-false arm moved to C11's ladder. Positive controls added: **M14** (stack 06 → spec-ready, requires decided, gates false → must PASS with `[PASS] C11` + `[PASS] C12`) and **M15** (stack 09 → blocked, TBD kept → must PASS); **M13** re-targeted to `scaffolded` with invented tech keys → still `[FAIL] C11` (+C12). Matrix M1–M13 + M14/M15 positive controls. | Manual scenario run: spec-ready PASS, blocked PASS, invented-tech+scaffolded FAIL (C11+C12). `run_all.py --with-selfcheck` → OVERALL PASS on post-PR-#7-merge main (scaffolded stack-01 with in-repo evidence) |

Post-fix full harness run: `python tests/integration/run_all.py --with-selfcheck`
→ validate_catalog 21/21 PASS (incl. C12 and the QUALITY_GATES-aligned C11),
validate_schemas 4/4 PASS, selfcheck M1–M13 caught + M14/M15 positive
controls PASS, sensitivity probes OK, OVERALL: PASS (exit 0).

Note: PR #9 was merged by the owner (e9997cd, 2026-10-24T19:37:54Z) together
with PR #7 (stack-01 reference implementation, fb16a6e) and PR #8 (generator
symlink policy, 190b794). The round-3 review arrived after that merge, so
this fix is delivered as a new branch/PR (`feat/independent-qa-tur3`) on top
of the post-merge `main`, where stack-01 is `scaffolded` with in-repo
evidence (`verification.md`, stack-dir-relative — F-8 WARN as documented).

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

---

# Wave 5 Part C (clean-checkout Gate E verification) — 2026-10-25

Scope: docs/QUALITY_GATES.md **Gate E — Reproducibility** ("Documented setup
works from a clean checkout") and the Phase 3 acceptance criterion ("A clean
checkout can build, start, migrate, seed, test, and stop using documented
commands"). Method: **fresh `git clone` of `main` into a temp directory** (no
reuse of any prior checkout state), then the documented harness, generator
smoke, and a matrix of stack-documented commands **actually executed**. A
command that was not executed is recorded as `unverified`, never as passing.

Handover note (W6): the previous Part-C session (branch
`feat/independent-qa`, commit `2bb795c` "generalise C11 + M13") went silent
(~5 h). Its single commit was reviewed; nothing was inherited (see §C.0) and
Part C verifies `main` @ `249e85f` as-is.

## C.0 Handover review — W6 commit 2bb795c not merged, its target defect already fixed on main

`origin/feat/independent-qa` head `2bb795c` (2026-10-24 21:24) generalises
C11 to every non-proposed stack and adds mutation **M13** (stack 05 promoted
in manifest+catalog with invented keys, all gates false → expect
`[FAIL] C11`). Findings:

- It is **not in `main`** (`git branch -r --contains` → only its own branch).
- Its context has diverged: `main` gained mutations **M14/M15** (PR #10,
  `a9ce55d` 2026-10-24 23:30, QUALITY_GATES maturity ladder) — after
  `2bb795c`, so a cherry-pick would conflict; rebase needed, not inheritance.
- Its motivating defect (C11 promotion gap for stacks 02–40) is **already
  closed on `main`**: W6's own `selfcheck_mutations.py` (extracted from
  `2bb795c`, run against `main`'s validators) reports
  **M13: CAUGHT (validate_catalog.py, exit 1, FAIL lines for ['C11'])** —
  main's ladder-aware C11 (PR #10, merged ~2 h after W6's commit) catches the
  promotion. W6's one-line report claim ("healthy main 21/21") was true for
  its pre-#10 base and is not reproducible against today's main.

Decision: Part C starts from current `main`; the generalised-C11/M13 patch
stays open work for the harness owner (needs a rebase onto #10's matrix).

## C.1 Environment (verification box)

Windows 11, C: drive started with ~14.7 GB
free. Toolchains used (all real, no mocks): git 2.x, Go 1.27.0
(windows/amd64), .NET SDK 10.0.401 (runtimes 9.0.8 + 10.0.12), Apache Maven
3.9.15 (JDK 21.0.11 default; **JDK 25.0.2 via JAVA_HOME for stack-01**), Node
v24.19.0 + npm (invoked as `npm.cmd`), PHP 8.3.33 + Composer 2.10.3, Python
3.13.2. Present but unused by the matrix: Docker CLI 29.1.3 (daemon not
exercised). **Missing toolchains** (their documented commands are recorded
`unverified`, never passing): Flutter SDK, Docker daemon, Rust/cargo, Ruby,
Elixir; `mongod` is not installed — stack-18 uses an in-process mongod via
`mongodb-memory-server` (Node-managed binary, downloaded on first run).

Environment caveats hit during verification:

- **Disk pressure (environment, not a repo defect):** stack-18's first run
  failed with `ENOSPC` while the mongod binary downloaded (C: hit 0 free).
  Caches were purged (`go clean -cache`, `go clean -modcache`, npm/pip
  caches, build outputs of already-verified stacks) to free ~1.8 GB; the
  re-run passed (§C.4). Verification boxes need ≥ 5 GB free.
- **PHP `pdo_sqlite` missing** (php.ini has `;extension=pdo_sqlite`
  commented): stack-15's documented `php artisan migrate` failed with
  "could not find driver". Worked around per-command without machine
  changes: `php -d extension=pdo_sqlite -d extension=sqlite3 ...`. The
  README honestly lists `pdo_sqlite` as a prerequisite — environment gap.
- **Windows/AV transient:** one stack-04 `go test` run printed all packages
  `ok` yet exited 1 with `unlinkat ... being used by another process`
  (test binary cleanup race); two re-runs exited 0. Not a stack defect.
- **PowerShell policy:** `npm` resolves to `npm.ps1` (blocked); `npm.cmd`
  used throughout — documented for future Windows verifiers.

## C.2 Fresh clone + independent harness — **FAIL (F-C1, High)**

`git clone https://github.com/AdemDemirFE/create-anything-ai.git` →
`main` @ `249e85f`, clean tree. Then
`python tests/integration/run_all.py`:

```text
validate_catalog.py: Summary: 20 passed, 1 failed, 10 warning(s) → RESULT: FAIL
validate_schemas.py: Summary: 4 passed, 0 failed → RESULT: PASS
OVERALL: FAIL (exit 1)
```

The one failure:

```text
[FAIL] C08: 15-laravel12-vue3-inertia-flutter:
manifest maturity 'scaffolded' != catalog 'proposed'
```

Root cause (traced with `git log`):

- PR #25 (`0a44e7e`, stack-15 implementation) set the **manifest** to
  `scaffolded` but never touched `stacks/catalog.json` (last modified by PR
  #24, `0ec350f`); PR #27 (`06dfc54`) refreshed only `STACK_CATALOG.md`.
  Markdown (proposed), catalog JSON (proposed) and manifest (scaffolded)
  now disagree.
- **CI gap:** `.github/workflows/ci.yml` validates manifests in isolation;
  the manifest↔catalog cross-check (C08) runs **only** in the independent
  harness, so `main` is CI-green while its own documented harness is red —
  the repo currently fails Gate E's "documented setup works from a clean
  checkout" out of the box.

Blast radius on the self-check (`run_all.py --with-selfcheck`, also run):

- Positive controls **M8/M14/M15: NOT CAUGHT (missed)** — their expected
  state ("must pass with a warning", exit 0 on the mutated-but-valid copy)
  is violated because the poisoned C08 baseline makes
  `validate_catalog.py` exit 1 everywhere.
- Sensitivity probes **M9/M11 fail** their precondition ("validate_catalog.py
  exited 1 on an UNMUTATED copy; the healthy-tree baseline ... must be
  exit 0"); M10/M11(caught)/M13 remain fine; **M1–M7, M9–M13 mutations
  themselves are all still CAUGHT**.
- Takeaway for the harness owner: one stale data row poisons the mutation
  self-check's healthy baseline. Fix the data (F-C1) first; optionally teach
  selfcheck to treat a known-unhealthy baseline as an explicit "HARNESS
  BLOCKED" state instead of mutation misses.

Generator-side corroboration: the generator (reads `catalog.json`) reports
`Maturity: proposed=31, scaffolded=9` — consistent with the stale catalog.

## C.3 Generator smoke (fresh clone) — PASS (with notes)

All commands from the repo root of the fresh clone; `tmp/` removed after.

| Command | Result |
|---|---|
| `node packages/generator/bin/create-anything-ai.js list` | 40 lines, `01. … [scaffolded] …` → `40. 40-python-fastapi-websockets-threejs [proposed] realtime-3d` |
| `… validate` | `Validated 40 stacks in catalog v0.1.0 (schema 1.0.0)`, Categories: 9, Maturity: proposed=31, scaffolded=9, exit 0 |
| `… generate 01-java25-springboot-react-flutter --output tmp --dry-run` | Plan printed (README.md, stack.json, docs/, backend/, web/, mobile/), "no files were written", exit 0 |
| `… generate 01-java25-springboot-react-flutter --output tmp` | created README.md + stack.json + 4 empty dirs; README header shows id/category/maturity; stack.json has all four gates `false`, `evidencePath: null` — minimum-content contract met |

Notes (not defects):

- `generate stack-01` (numeric shorthand, as in the task brief) is rejected
  with `E_INVALID_STACK` (exit 1) — the contract requires the full catalog
  id `NN-lowercase-hyphenated`; `GENERATOR_CONTRACT.md` and the README agree.
- The `scaffolded` label in the generated README comes from the **stale
  catalog** row for 15 (F-C1) only affects that stack's row in `list`.

## C.4 Stack command matrix — real runs on the fresh clone

Every command below was actually executed in
`%TEMP%\qa-part-c\clean-clone`. "Doc" = count claimed in the stack's
README/verification docs.

| Stack · part | Command (documented form) | Result | Doc cross-check |
|---|---|---|---|
| 04 · backend | `go test ./... -count=1` | **PASS**, exit 0 (3 runs; -v count **34** tests) | doc says 31 — count drift (low) |
| 20 · backend | venv + `pip install -r requirements.txt` | install exit 0 | pinned deps resolve |
| 20 · backend | `.venv\Scripts\python.exe -m pytest` | **81 passed**, 2 warnings, exit 0 | doc says 64 — count drift (low) |
| 20 · web | `npm install` + `npm test` + `npm run build` | **19/19 passed**; build ✓ (dist emitted), exits 0 | matches (19) |
| 35 · backend | `dotnet test` (from `backend/tests`, as documented) | **37/37 passed**, exit 0 | matches (37) |
| 35 · web | `npm test` + `npm run build` | **17/17 passed**; build ✓, exits 0 | matches (17) |
| 01 · backend | `mvn test` (JAVA_HOME=jdk-25.0.2) | **Tests run: 30, BUILD SUCCESS**, exit 0; fresh-clone run incl. dependency downloads ≈ 63 s | matches (30; verification.md per-class counts sum to 30) |
| 15 · laravel | `composer install`; `cp .env.example .env`; `key:generate`; `migrate` (with `php -d extension=…`) | composer/migrate exit 0 after env workaround | prerequisite `pdo_sqlite` honestly documented (env gap, §C.1) |
| 15 · laravel | `php vendor\phpunit\phpunit\phpunit` (documented, with env workaround) | **documented setup: 54 tests, 9 FAILURES** (AuthFlow/LoginThrottle from PR #28; "Cache store [] is not defined") → **F-C2**; with `LOGIN_THROTTLE_STORE=database`: **OK, 54 tests, 269 assertions**, exit 0 | doc says 49 tests — count drift; PR #28 tests uncounted |
| 21 · django | venv + `pip install "django>=5.2,<6.0"`; `manage.py test` | **Found 48 tests — OK**, exit 0 | doc says 46 — count drift (low) |
| 36 · backend | `go test ./... -count=1` | **PASS**, exit 0; -v count **36/36** | matches (36) |
| 08 · web | `npm install` + `npm test` + `npm run build` + RLS audit | **64 passed but 1 suite failed to load** → exit 1 (**F-C3**); build ✓; RLS audit from stack root: OK (2 migrations, 4 policies); from `web/` per README: ENOENT (**F-C4**) | verification.md claims "80 passed (9 files)" — the 9th file never loads on this box; 80 is not reproducible (64 counted) |
| 18 · server | `npm install` + `npm test` (in-process mongod) + `npm run build` | first run ENOSPC (disk, §C.1); after freeing space: **63/63 passed**, build ✓, exits 0 | README documents in-process mongod honestly |

Unverified here (toolchain absent — recorded, never claimed passing):
Flutter clients (stacks 01/04/15 mobile targets), Docker/compose flows
(stacks 01/04/35 compose files, stack-08 `supabase local`), Rust
(stack-07/31/39), Ruby (stack-22), Elixir (stack-37). Live-server smokes
documented as requiring a running process (stack-15 `smoke.mjs`,
stack-21 `smoke.py`, stack-36 two-client live smoke) were not exercised —
out of the agreed subset; their test-gate claims above stand on the real
runs recorded.

## C.5 Findings (Part C, severity ordered)

| ID | Severity | Area | Finding | Evidence | Recommended fix |
|---|---|---|---|---|---|
| F-C1 | **High** (fresh-checkout breaker) | `stacks/catalog.json` + CI | stack-15 manifest `scaffolded` ≠ catalog `proposed` → harness **OVERALL FAIL on a fresh clone**; also poisons selfcheck M8/M14/M15 + M9/M11 probes; CI never runs the cross-check so main stays green | §C.2; PR #25 updated manifest only | Set catalog entry 15 → `scaffolded` (matches manifest + reality), then re-run harness; add C08 cross-check (or the whole harness) to CI |
| F-C2 | **High** (fresh-checkout breaker for stack-15) | `stacks/15-…/laravel/.env.example:71` | `LOGIN_THROTTLE_STORE=` (empty) makes `env('LOGIN_THROTTLE_STORE', env('CACHE_STORE','array'))` resolve to `''` → `Cache store [] is not defined` → login 500, **9/54 tests fail** on the documented `cp .env.example .env` path | §C.4 stack-15 row | Delete the empty line (or comment it out) so the fallback chain works; sync README's "49 tests" → 54 while touching it |
| F-C3 | Medium | stack-08 `scripts/verify-migrations.mjs` | Shebang line makes the module fail under vitest's SSR transform (`SyntaxError: Invalid or unexpected token`); Node CLI execution is fine. `web/src/lib/migrations.test.ts` imports it → 1 dead suite, `npm test` exits 1 (64 pass, 9th file 0 tests) | §C.4; isolated probe: shebang copy fails, shebang-stripped copy imports OK under vitest | Drop the shebang (it is not a CLI entry — `web/package.json` calls it via `node`), or exclude it from vitest transform and import the stripped module |
| F-C4 | Medium | stack-08 README:79 | Documented `node ..\scripts\verify-migrations.mjs` from `web/` fails: script resolves `supabase/migrations` against the **CWD** → `ENOENT`; from the stack root it passes | §C.4 | Document the stack-root invocation, or resolve the dir relative to the script file (`import.meta.url`) |
| F-C5 | Low | stack docs (counts) | Test-count drift after follow-up commits: stack-04 31→34, stack-20 backend 64→81, stack-15 49→54, stack-21 46→48 | §C.4 cross-check column | Update counts (or drop exact counts in favor of "all green") when follow-up PRs add tests |
| F-C6 | Low | harness robustness | Selfcheck's healthy-tree baseline is read from live data: a single stale catalog row turns M8/M14/M15 "NOT CAUGHT" and breaks M9/M11 probe preconditions, masking the real, simple root cause | §C.2 blast radius | After F-C1: consider a "HARNESS BLOCKED (data)" distinct failure mode when the unmutated baseline is non-zero, instead of per-mutation misses |
| F-C7 | Info | generator ergonomics | `generate stack-01` shorthand is rejected (`E_INVALID_STACK`); full id required. Contract and docs are consistent — recorded so future verifiers do not mistake it for a bug | §C.3 | Optional UX: accept `NN`/`stack-NN` shorthand with a hint |

Environment-only items (no repo action): PHP `pdo_sqlite` disabled on this
box (worked around per-command); C: disk pressure during mongod download
(ENOSPC) — boxes need ≥ 5 GB free; Windows AV transient on first `go test`
cleanup; `npm.ps1` execution policy (use `npm.cmd`).

## C.6 Verdict (Part C)

- **Gate E is currently FAILED for `main` @ `249e85f`**: the documented
  independent harness does not pass on a fresh clone (F-C1), and one
  documented stack quick-start (stack-15) breaks login+tests from the
  shipped `.env.example` (F-C2). Two more documented commands fail as
  written (F-C3, F-C4).
- Everything else actually executed is green on the fresh clone: generator
  smoke (list/validate/dry-run/generate), and real test suites for stacks
  01 (30), 04 (34), 08 web (64 + build), 15 laravel (54 after the one-line
  env fix), 18 server (63 + build), 20 (81 + web 19 + build), 21 (48),
  35 (37 + web 17 + build), 36 (36) — all exit 0.
- No command was marked passing without having been executed; missing
  toolchains are recorded `unverified` in §C.4.
- Fix path to green Gate E: (1) catalog row 15 → `scaffolded` + CI runs the
  harness (F-C1/F-C6), (2) `.env.example` one-line fix (F-C2), (3) stack-08
  shebang + README invocation fixes (F-C3/F-C4), (4) count drift cleanup
  (F-C5).
