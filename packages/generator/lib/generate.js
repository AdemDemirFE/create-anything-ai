// Skeleton generation engine for the generator CLI.
// All filesystem writes are funnelled through the guarded helpers here.

import path from 'node:path';
import fs from 'node:fs';
import { errorWithCode } from './errors.js';
import { titleFromId, STACK_ID_PATTERN } from './catalog.js';
import { assertSafeOutputPath, assertNoSymlinkAncestry, isInsideRoot } from './paths.js';

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
 * Generate a skeleton for `stack` inside `outputDir`.
 *
 * Safety:
 * - `allowedRoot` is mandatory: writes outside it are refused (E_UNSAFE_PATH),
 * - refuses to create output under a symlinked path (E_UNSAFE_PATH),
 * - refuses to overwrite any existing file unless `force` is true (E_TARGET_EXISTS),
 * - never runs shell commands and never writes outside `absOutput`.
 *
 * Returns a report:
 * { outputDir, created: [...], skipped: [...], forced: [...], dryRun?, planned? }
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
  assertNoSymlinkAncestry(absOutput);

  const plan = planGeneration(stack, absOutput);
  const report = { outputDir: absOutput, created: [], skipped: [], forced: [] };

  if (dryRun) {
    report.dryRun = true;
    report.planned = [...plan.files.map((f) => f.path), ...plan.dirs.map((d) => `${d}/`)];
    return report;
  }

  // Create the output directory (parents included). We have already verified
  // that no existing ancestor is a symlink; race windows remain theoretical
  // for a local CLI and are re-checked per write below.
  fs.mkdirSync(absOutput, { recursive: true });

  // Empty platform directories.
  for (const dir of plan.dirs) {
    const absDir = path.join(absOutput, dir);
    if (!isInsideRoot(absDir, absOutput)) {
      throw errorWithCode('E_UNSAFE_PATH', `Planned directory escaped output root: ${absDir}`);
    }
    fs.mkdirSync(absDir, { recursive: true });
  }

  // Files with overwrite protection.
  for (const file of plan.files) {
    const absFile = path.join(absOutput, file.path);
    if (!isInsideRoot(absFile, absOutput)) {
      throw errorWithCode('E_UNSAFE_PATH', `Planned file escaped output root: ${absFile}`);
    }
    const exists = fs.existsSync(absFile);
    if (exists && !force) {
      report.skipped.push(file.path);
      continue;
    }
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
