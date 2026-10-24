// Path-safety primitives for the generator CLI.
// Symlink safety is realpath-based: benign OS-level symlinks (macOS /tmp ->
// /private/tmp, Windows junctions) pass; only chains that resolve OUTSIDE
// the allowed root are refused.

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
 * Best-effort realpath. For a target whose leaf does not exist yet, the
 * deepest existing ancestor is resolved with realpathSync and the missing
 * suffix is appended lexically — mirroring what the OS will do when the
 * directory is created.
 *
 * A dangling symlink (an existing entry whose destination is missing) cannot
 * be proven contained: returns `null` so callers can refuse the path.
 * Other errors fall back to the resolved input.
 */
export function safeRealpath(target) {
  const abs = path.resolve(target);
  let cursor = abs;
  const missing = [];
  for (;;) {
    let real;
    try {
      real = fs.realpathSync(cursor);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return abs;
      }
      // Distinguish "cursor does not exist" from "cursor exists but its
      // symlink destination is missing" (dangling link).
      try {
        const st = fs.lstatSync(cursor);
        if (st.isSymbolicLink()) {
          return null; // dangling symlink: containment cannot be proven
        }
      } catch {
        // cursor itself does not exist: keep unwinding.
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return abs;
      }
      missing.unshift(path.basename(cursor));
      cursor = parent;
      continue;
    }
    if (missing.length === 0) {
      return real;
    }
    return path.join(real, ...missing);
  }
}

/**
 * Assert that the REAL path of `target` (symlinks resolved) lies inside the
 * REAL path of `root`. Benign OS-level symlinks are fine as long as the
 * resolved destination stays inside the root; a chain that resolves outside
 * is an escape and is refused.
 * Returns the real path of the target.
 */
export function assertRealpathContainment(target, root) {
  const realTarget = safeRealpath(target);
  const realRoot = safeRealpath(root);
  // A dangling symlink (or any path whose containment cannot be proven) is
  // refused: refuse-by-default for unresolvable chains.
  if (realTarget === null || realRoot === null || !isInsideRoot(realTarget, realRoot)) {
    throw errorWithCode(
      'E_UNSAFE_PATH',
      `Refusing to write outside the allowed root: ${path.resolve(target)} cannot be proven to resolve inside ${path.resolve(root)} (symlink escape protection)`,
    );
  }
  return realTarget;
}

/**
 * Assert the target path is safe to use as a generation output directory:
 * - resolves to an absolute path,
 * - must lie inside (or equal to) the allowed root (lexical check),
 * - must never be a filesystem root (e.g. C:\ or /).
 * Symlink escapes are checked separately via assertRealpathContainment.
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
