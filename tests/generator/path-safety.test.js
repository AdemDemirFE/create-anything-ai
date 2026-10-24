// Security tests: path traversal, symlink escape, protected roots, CLI output policy.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveOutputDir,
  isInsideRoot,
  assertSafeOutputPath,
  assertCliOutputPolicy,
  assertNoSymlinkAncestry,
} from '../../packages/generator/lib/paths.js';
import { generateSkeleton } from '../../packages/generator/lib/generate.js';
import { errorWithCode } from '../../packages/generator/lib/errors.js';
import { makeTempDir } from './helpers.js';

function fixtureStack(overrides = {}) {
  return {
    id: '01-fixture-stack-1',
    number: 1,
    category: 'fixture-category',
    maturity: 'proposed',
    ...overrides,
  };
}

const onWindows = process.platform === 'win32';

describe('resolveOutputDir', () => {
  test('resolves relative paths against cwd', () => {
    const resolved = resolveOutputDir('some/out');
    assert.ok(path.isAbsolute(resolved));
  });

  test('rejects empty and NUL-byte inputs', () => {
    for (const bad of ['', '   ', null, undefined, 'out\0dir']) {
      assert.throws(() => resolveOutputDir(bad), (err) => err.code === 'E_UNSAFE_PATH', String(bad));
    }
  });
});

describe('isInsideRoot', () => {
  test('accepts root itself and nested children', () => {
    assert.equal(isInsideRoot('C:\\work', 'C:\\work'), true);
    assert.equal(isInsideRoot('C:\\work\\child', 'C:\\work'), true);
  });

  test('rejects siblings and prefix lookalikes', () => {
    assert.equal(isInsideRoot('C:\\work2', 'C:\\work'), false);
    assert.equal(isInsideRoot('C:\\other\\child', 'C:\\work'), false);
  });
});

describe('assertSafeOutputPath', () => {
  test('keeps children of the allowed root', () => {
    const tmp = makeTempDir();
    try {
      const abs = assertSafeOutputPath(path.join(tmp.path, 'proj'), tmp.path);
      assert.ok(abs.startsWith(tmp.path));
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects escapes outside the allowed root', () => {
    const tmp = makeTempDir();
    try {
      assert.throws(
        () => assertSafeOutputPath(path.join(tmp.path, '..', 'escape'), tmp.path),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.throws(
        () => assertSafeOutputPath(onWindows ? 'D:\\elsewhere' : '/elsewhere', tmp.path),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects traversal attempts that resolve outside', () => {
    const tmp = makeTempDir();
    try {
      const evil = path.join(tmp.path, 'a', '..', '..', '..', 'evil');
      assert.throws(
        () => assertSafeOutputPath(evil, tmp.path),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects filesystem roots', () => {
    const tmp = makeTempDir();
    try {
      assert.throws(
        () => assertSafeOutputPath(path.parse(tmp.path).root, tmp.path),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });
});

describe('assertNoSymlinkAncestry', () => {
  test('passes for normal nested paths', () => {
    const tmp = makeTempDir();
    try {
      const target = path.join(tmp.path, 'a', 'b', 'c');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assert.equal(assertNoSymlinkAncestry(target), path.resolve(target));
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects when the target itself is a symlink', (t) => {
    const tmp = makeTempDir();
    try {
      const real = path.join(tmp.path, 'real');
      const link = path.join(tmp.path, 'link');
      fs.mkdirSync(real);
      let made = false;
      try {
        fs.symlinkSync(real, link, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      assert.throws(
        () => assertNoSymlinkAncestry(link),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects when a mid-ancestor is a symlink', (t) => {
    const tmp = makeTempDir();
    try {
      const real = path.join(tmp.path, 'real');
      const link = path.join(tmp.path, 'link');
      fs.mkdirSync(real);
      let made = false;
      try {
        fs.symlinkSync(real, link, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      const target = path.join(link, 'child');
      assert.throws(
        () => assertNoSymlinkAncestry(target),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });
});

describe('assertCliOutputPolicy', () => {
  const cwd = onWindows ? 'C:\\work' : '/work';

  test('relative outputs must stay inside cwd', () => {
    assert.throws(
      () => assertCliOutputPolicy('..\\..\\escape', { cwd, repoRoot: null }),
      (err) => err.code === 'E_UNSAFE_PATH',
    );
    const ok = assertCliOutputPolicy('sub\\dir', { cwd, repoRoot: null });
    assert.ok(ok.startsWith(path.resolve(cwd)));
  });

  test('rejects filesystem root, home dir and repo root', () => {
    const home = os.homedir();
    assert.throws(() => assertCliOutputPolicy(path.parse(cwd).root, { cwd }), (err) => err.code === 'E_UNSAFE_PATH');
    assert.throws(() => assertCliOutputPolicy(home, { cwd }), (err) => err.code === 'E_UNSAFE_PATH');
    assert.throws(() => assertCliOutputPolicy('C:\\repo', { cwd, repoRoot: 'C:\\repo' }), (err) => err.code === 'E_UNSAFE_PATH');
  });

  test('absolute subpaths outside cwd are allowed (user preference) but roots are not', () => {
    const abs = onWindows ? 'C:\\elsewhere\\my-app' : '/elsewhere/my-app';
    const ok = assertCliOutputPolicy(abs, { cwd, repoRoot: null });
    assert.equal(ok, path.resolve(abs));
  });
});

describe('generateSkeleton hardening', () => {
  test('refuses to write outside allowedRoot (E_UNSAFE_PATH)', () => {
    const tmp = makeTempDir();
    try {
      const outside = path.join(path.dirname(tmp.path), 'outside-target');
      assert.throws(
        () => generateSkeleton(fixtureStack(), outside, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.equal(fs.existsSync(outside), false, 'nothing may be created outside the root');
    } finally {
      tmp.cleanup();
    }
  });

  test('refuses traversal-style output that resolves outside allowedRoot', () => {
    const tmp = makeTempDir();
    try {
      const evil = path.join(tmp.path, 'sub', '..', '..', 'escaped');
      assert.throws(
        () => generateSkeleton(fixtureStack(), evil, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('refuses symlinked output location (E_UNSAFE_PATH)', (t) => {
    const tmp = makeTempDir();
    try {
      const real = path.join(tmp.path, 'real-dir');
      const link = path.join(tmp.path, 'evil-link');
      fs.mkdirSync(real);
      let made = false;
      try {
        fs.symlinkSync(real, link, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      assert.throws(
        () => generateSkeleton(fixtureStack(), link, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.equal(fs.readdirSync(real).length, 0, 'symlink target must remain empty');
    } finally {
      tmp.cleanup();
    }
  });

  test('E_UNSAFE_PATH never leaves the filesystem root writable by mistake', () => {
    const tmp = makeTempDir();
    try {
      const root = path.parse(tmp.path).root;
      assert.throws(
        () => generateSkeleton(fixtureStack(), root, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('--force refuses to overwrite a symlink planted at a planned file path', (t) => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      fs.mkdirSync(out);
      const victim = path.join(tmp.path, 'victim.txt');
      fs.writeFileSync(victim, 'do not touch', 'utf8');

      let made = 0;
      for (const name of ['README.md', 'stack.json']) {
        try {
          fs.symlinkSync(victim, path.join(out, name), 'file');
          made++;
        } catch {
          t.skip('symlinks not permitted on this host');
          return;
        }
      }
      assert.equal(made, 2);

      // Without --force the symlinks are simply skipped (no overwrite attempt).
      const skippedRun = generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path });
      assert.deepEqual(skippedRun.skipped.sort(), ['README.md', 'stack.json']);
      assert.equal(fs.readFileSync(victim, 'utf8'), 'do not touch');

      // With --force the write must be refused instead of following the symlink.
      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path, force: true }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.equal(fs.readFileSync(victim, 'utf8'), 'do not touch', 'symlink target must survive --force');
    } finally {
      tmp.cleanup();
    }
  });

  test('--force refuses a symlink planted at a planned subdirectory path', (t) => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      fs.mkdirSync(out);
      const outsideDir = path.join(tmp.path, 'outside');
      fs.mkdirSync(outsideDir);

      let made = false;
      try {
        fs.symlinkSync(outsideDir, path.join(out, 'docs'), 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);

      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path, force: true }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.deepEqual(fs.readdirSync(outsideDir), [], 'symlink target directory must stay empty');
    } finally {
      tmp.cleanup();
    }
  });

  test('--force refuses a symlink planted at a mid-level ancestor of a planned file', (t) => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      fs.mkdirSync(out);
      const outsideDir = path.join(tmp.path, 'outside');
      fs.mkdirSync(outsideDir);

      let made = false;
      try {
        fs.symlinkSync(outsideDir, path.join(out, 'docs'), 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);

      // A file under a symlinked planned directory must never be written.
      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path, force: true }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.deepEqual(fs.readdirSync(outsideDir), []);
    } finally {
      tmp.cleanup();
    }
  });
});
