// Path-safety primitives for the generator CLI.
// Pure path math with Node's built-in path module; fs calls are limited to lstat/exists.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { errorWithCode } from './errors.js';

/**
 * Resolve an output directory to an absolute path without requiring existence.
 * Rejects empty strings and NUL bytes.
 */
export function resolveOutputDir(outputDir) {
  if (typeof outputDir !== 'string' || outputDir.trim().length === 0) {
    throw errorWithCode('E_UNSAFE_PATH', 'Output directory must be a non-empty string');
  }
  const trimmed = outputDir.trim();
  if (trimmed.includes('\0')) {
    throw errorWithCode('E_UNSAFE_PATH', 'Output directory must not contain NUL bytes');
  }
  return path.resolve(trimmed);
}

/**
 * True when `child` is `root` itself or lies strictly inside `root`
 * (both absolute, both normalized).
 */
export function isInsideRoot(child, root) {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Assert the target path is safe to use as a generation output directory:
 * - resolves to an absolute path,
 * - must be inside (or equal to) the allowed root,
 * - must never be a filesystem root (e.g. C:\ or /).
 * Returns the resolved absolute path.
 */
export function assertSafeOutputPath(outputDir, allowedRoot) {
  const abs = resolveOutputDir(outputDir);
  const root = path.resolve(allowedRoot);
  if (!isInsideRoot(abs, root)) {
    throw errorWithCode(
      'E_UNSAFE_PATH',
      `Refusing to write outside the allowed root: ${abs} is not inside ${root}`,
    );
  }
  if (path.parse(abs).root === abs) {
    throw errorWithCode('E_UNSAFE_PATH', 'Refusing to use a filesystem root as output directory');
  }
  return abs;
}

/**
 * CLI-level output policy:
 * - relative outputs must resolve inside the current working directory,
 * - absolute outputs are allowed but must not be a filesystem root,
 *   the OS home directory, or the repository root containing the catalog.
 * Returns the resolved absolute path.
 */
export function assertCliOutputPolicy(outputDir, { cwd = process.cwd(), repoRoot = null } = {}) {
  const trimmed = typeof outputDir === 'string' ? outputDir.trim() : '';
  const abs = path.resolve(cwd, trimmed);
  if (!path.isAbsolute(trimmed)) {
    // Relative output must resolve inside the given cwd (path.resolve already
    // collapses traversal; anything escaping cwd is rejected here).
    if (!isInsideRoot(abs, path.resolve(cwd))) {
      throw errorWithCode(
        'E_UNSAFE_PATH',
        `Relative --output must stay inside the current directory: ${abs} is outside ${path.resolve(cwd)}`,
      );
    }
  }
  if (path.parse(abs).root === abs) {
    throw errorWithCode('E_UNSAFE_PATH', 'Refusing to use a filesystem root as output directory');
  }
  const home = path.resolve(os.homedir());
  if (abs === home) {
    throw errorWithCode('E_UNSAFE_PATH', 'Refusing to use the home directory as output directory');
  }
  if (repoRoot && abs === path.resolve(repoRoot)) {
    throw errorWithCode('E_UNSAFE_PATH', 'Refusing to use the repository root as output directory');
  }
  return abs;
}

/**
 * Verify that no currently-existing entry on the absolute path `target`
 * — from the filesystem root all the way down to `target` itself — is a
 * symlink or junction, preventing symlink escape at generation time.
 * Every existing component is lstat'd; components that do not exist yet
 * cannot be symlinks and are skipped.
 * Returns the resolved absolute path; throws E_UNSAFE_PATH on a symlink.
 */
export function assertNoSymlinkAncestry(target) {
  const abs = path.resolve(target);

  // Walk every component from the filesystem root down to `abs`.
  const relative = path.relative(path.parse(abs).root, abs);
  const segments = relative.length === 0 ? [] : relative.split(path.sep);
  let cursor = path.parse(abs).root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch {
      // Component does not exist (yet) or is not accessible: it cannot be a
      // symlink now, and later components beneath a missing directory cannot
      // exist either.
      return abs;
    }
    if (stat.isSymbolicLink()) {
      throw errorWithCode(
        'E_UNSAFE_PATH',
        `Refusing to follow symlink at "${cursor}" (symlink escape protection)`,
      );
    }
  }
  return abs;
}
