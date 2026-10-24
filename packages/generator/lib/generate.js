// Skeleton generation engine for the generator CLI.
// All filesystem writes are funnelled through the guarded helpers here.
// Symlink policy is realpath-based: benign OS-level symlinks (macOS /tmp,
// Windows junctions) are allowed; only chains that resolve outside the
// allowed root are refused (E_UNSAFE_PATH).

import path from 'node:path';
import fs from 'node:fs';
import { errorWithCode } from './errors.js';
import { titleFromId, STACK_ID_PATTERN } from './catalog.js';
import { assertSafeOutputPath, assertRealpathContainment, safeRealpath, isInsideRoot } from './paths.js';

/** Directories created inside every generated stack skeleton. */
export const SKELETON_DIRS = Object.freeze(['docs', 'backend', 'web', 'mobile']);

/**
 * Validate a stack id syntactically.
 * Returns { ok, code, message }.
 */
export function checkStackId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, code: 'E_INVALID_STACK', message: 'Stack id is required (e.g. 01-java25-springboot-react-flutter)' };
  }
  if (!STACK_ID_PATTERN.test(id)) {
    return {
      ok: false,
      code: 'E_INVALID_STACK',
      message: `Invalid stack id "${id}": expected pattern NN-lowercase-hyphenated (e.g. 01-java25-springboot-react-flutter)`,
    };
  }
  return { ok: true };
}

/** Build the stack.json template content for a stack. Deterministic. */
export function renderStackJson(stack) {
  const manifest = {
    id: stack.id,
    name: titleFromId(stack.id),
    category: stack.category,
    maturity: stack.maturity,
    description: `${titleFromId(stack.id)} — scaffolded from stacks/catalog.json by the create-anything-ai generator.`,
    requires: [],
    verification: {
      manifest: false,
      unit: false,
      integration: false,
      e2e: false,
      lastVerifiedAt: null,
      evidencePath: null,
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Build the README.md template content for a stack. Deterministic. */
export function renderReadme(stack) {
  const title = titleFromId(stack.id);
  return [
    `# ${title}`,
    '',
    `> Stack ID: \`${stack.id}\` · Category: ${stack.category} · Maturity: ${stack.maturity}`,
    '',
    'This project was scaffolded by the Create Anything AI generator.',
    'It contains only a skeleton: a stack manifest and empty platform directories.',
    'It is **not** production-ready; see `stack.json` verification fields and docs/QUALITY_GATES.md.',
    '',
    '## Layout',
    '',
    '- `stack.json` — machine-readable stack manifest (schemas/stack-manifest.schema.json)',
    '- `README.md` — this file',
    '- `docs/` — architecture, specification and verification notes',
    '- `backend/`, `web/`, `mobile/` — platform skeletons (fill in or delete as needed)',
    '',
    '## Next steps',
    '',
    '1. Replace this skeleton description with a real stack specification.',
    '2. Implement the smallest coherent application before claiming any maturity above `proposed`.',
    '3. Attach real verification evidence per docs/QUALITY_GATES.md.',
    '',
  ].join('\n');
}

/**
 * Plan the generation without touching the filesystem.
 * Returns { files: [{ path, action }], dirs: [relative paths] }.
 */
export function planGeneration(stack, outputDir) {
  const files = [
    { path: 'README.md', action: 'create' },
    { path: 'stack.json', action: 'create' },
  ];
  return { files, dirs: [...SKELETON_DIRS] };
}

/**
 * Inspect a planned entry path with lstat (which, unlike existsSync, does not
 * follow symlinks). Returns { stat, kind } where kind is
 * 'missing' | 'file' | 'directory' | 'symlink'; throws E_IO on other errors.
 */
function inspectPlannedEntry(absPath, label) {
  try {
    const stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink()) return { stat, kind: 'symlink' };
    if (stat.isDirectory()) return { stat, kind: 'directory' };
    if (stat.isFile()) return { stat, kind: 'file' };
    return { stat, kind: 'other' };
  } catch (err) {
    if (err.code === 'ENOENT') return { stat: null, kind: 'missing' };
    throw errorWithCode('E_IO', `Cannot inspect planned ${label}: ${err.message}`);
  }
}

/**
 * Generate a skeleton for `stack` inside `outputDir`.
 *
 * Safety:
 * - `allowedRoot` is mandatory: lexical escapes are refused (E_UNSAFE_PATH),
 * - every planned path must resolve, through symlinks, INSIDE the real path
 *   of the allowed root; escapes are refused (E_UNSAFE_PATH). Benign OS-level
 *   symlinks (macOS /tmp -> /private/tmp, Windows junctions) are allowed,
 * - a symlink at a planned file/dir path itself is refused, even when its
 *   destination would be inside the root: generated content must land in the
 *   directory the user chose, not somewhere the link points (E_UNSAFE_PATH),
 * - a file occupying a planned directory path or a directory occupying a
 *   planned file path is a hard conflict (E_TARGET_EXISTS),
 * - never runs shell commands.
 *
 * Returns a report:
 * { outputDir, realOutputDir, created, skipped, forced, dryRun?, planned? }
 */
export function generateSkeleton(stack, outputDir, { allowedRoot, force = false, dryRun = false } = {}) {
  if (!allowedRoot) {
    throw errorWithCode('E_UNSAFE_PATH', 'Internal error: allowedRoot is required');
  }
  const idCheck = checkStackId(stack?.id);
  if (!idCheck.ok) {
    throw errorWithCode(idCheck.code, idCheck.message);
  }

  const absOutput = assertSafeOutputPath(outputDir, allowedRoot);
  // The output directory chain may pass through benign OS symlinks, but its
  // real destination must stay inside the real root.
  const realOutput = assertRealpathContainment(absOutput, allowedRoot);
  // The OUTPUT directory itself must not be a symlink: generated content has
  // to land in the directory the user chose, not wherever the link points.
  {
    let st = null;
    try {
      st = fs.lstatSync(absOutput);
    } catch {
      // missing: mkdir below creates it
    }
    if (st && st.isSymbolicLink()) {
      throw errorWithCode(
        'E_UNSAFE_PATH',
        `Refusing to use symlink "${absOutput}" as output directory (symlink escape protection)`,
      );
    }
  }

  const plan = planGeneration(stack, absOutput);
  const report = { outputDir: absOutput, realOutputDir: realOutput, created: [], skipped: [], forced: [] };

  if (dryRun) {
    report.dryRun = true;
    report.planned = [...plan.files.map((f) => f.path), ...plan.dirs.map((d) => `${d}/`)];
    return report;
  }

  fs.mkdirSync(absOutput, { recursive: true });

  // Empty platform directories.
  for (const dir of plan.dirs) {
    const absDir = path.join(absOutput, dir);
    if (!isInsideRoot(absDir, absOutput)) {
      throw errorWithCode('E_UNSAFE_PATH', `Planned directory escaped output root: ${absDir}`);
    }
    const { kind } = inspectPlannedEntry(absDir, `directory "${dir}"`);
    if (kind === 'symlink') {
      throw errorWithCode(
        'E_UNSAFE_PATH',
        `Refusing to write through symlink at planned directory "${absDir}" (symlink escape protection)`,
      );
    }
    if (kind === 'file' || kind === 'other') {
      throw errorWithCode(
        'E_TARGET_EXISTS',
        `Planned directory "${dir}" already exists as a non-directory entry: ${absDir}. Remove it or choose another output directory.`,
      );
    }
    fs.mkdirSync(absDir, { recursive: true });
  }

  // Files with overwrite protection.
  for (const file of plan.files) {
    const absFile = path.join(absOutput, file.path);
    if (!isInsideRoot(absFile, absOutput)) {
      throw errorWithCode('E_UNSAFE_PATH', `Planned file escaped output root: ${absFile}`);
    }
    const { kind } = inspectPlannedEntry(absFile, `file "${file.path}"`);
    if (kind === 'symlink') {
      // existsSync would follow this link; with --force the old write would
      // have gone through it. Refuse regardless of --force: the generated
      // file must land at the planned path, not at the link's destination.
      throw errorWithCode(
        'E_UNSAFE_PATH',
        `Refusing to write through symlink at planned file "${absFile}" (symlink escape protection)`,
      );
    }
    if (kind === 'directory' || kind === 'other') {
      throw errorWithCode(
        'E_TARGET_EXISTS',
        `Planned file "${file.path}" already exists as a directory: ${absFile}. Remove it or choose another output directory.`,
      );
    }
    const exists = kind === 'file';
    if (exists && !force) {
      report.skipped.push(file.path);
      continue;
    }
    // Final containment check on the real destination of this exact file.
    assertRealpathContainment(absFile, allowedRoot);
    const content = file.path === 'stack.json' ? renderStackJson(stack) : renderReadme(stack);
    fs.writeFileSync(absFile, content, { encoding: 'utf8', flag: 'w' });
    if (exists) {
      report.forced.push(file.path);
    } else {
      report.created.push(file.path);
    }
  }

  return report;
}
