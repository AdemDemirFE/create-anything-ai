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
  assertRealpathContainment,
  safeRealpath,
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
  const root = path.resolve(process.platform === 'win32' ? 'C:\\work' : '/work');
  const child = path.join(root, 'child');
  const sibling = path.resolve(path.join(root, '..'), 'work2');
  const other = path.resolve(path.join(root, '..'), 'other', 'child');

  test('accepts root itself and nested children', () => {
    assert.equal(isInsideRoot(root, root), true);
    assert.equal(isInsideRoot(child, root), true);
  });

  test('rejects siblings and prefix lookalikes', () => {
    assert.equal(isInsideRoot(sibling, root), false);
    assert.equal(isInsideRoot(other, root), false);
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

describe('assertRealpathContainment (realpath-based symlink policy)', () => {
  test('passes for normal nested paths', () => {
    const tmp = makeTempDir();
    try {
      const target = path.join(tmp.path, 'a', 'b', 'c');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      assert.equal(assertRealpathContainment(target, tmp.path), path.resolve(target));
    } finally {
      tmp.cleanup();
    }
  });

  test('allows a benign OS-style symlink: root reached through a symlinked prefix', (t) => {
    const tmp = makeTempDir();
    try {
      // macOS /tmp -> /private/tmp analogue: the ROOT ITSELF (or a prefix of
      // it) resolves through a symlink; that must stay allowed.
      const realBase = path.join(tmp.path, 'private-tmp');
      const linkBase = path.join(tmp.path, 'tmp');
      fs.mkdirSync(realBase, { recursive: true });
      let made = false;
      try {
        fs.symlinkSync(realBase, linkBase, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      const target = path.join(linkBase, 'out', 'proj');
      // allowed root is expressed THROUGH the symlinked prefix, like /tmp/... on macOS.
      assert.equal(assertRealpathContainment(target, path.join(linkBase)), path.join(realBase, 'out', 'proj'));
    } finally {
      tmp.cleanup();
    }
  });

  test('allows symlinks INSIDE the root that resolve to another spot inside the root', (t) => {
    const tmp = makeTempDir();
    try {
      const innerReal = path.join(tmp.path, 'inner-real');
      const innerLink = path.join(tmp.path, 'inner-link');
      fs.mkdirSync(innerReal, { recursive: true });
      let made = false;
      try {
        fs.symlinkSync(innerReal, innerLink, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      const target = path.join(innerLink, 'child');
      assert.equal(assertRealpathContainment(target, tmp.path), path.join(innerReal, 'child'));
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects a symlink chain that resolves OUTSIDE the root', (t) => {
    const tmp = makeTempDir();
    try {
      const outside = path.join(path.dirname(tmp.path), 'outside-real');
      const link = path.join(tmp.path, 'link');
      fs.mkdirSync(outside, { recursive: true });
      let made = false;
      try {
        fs.symlinkSync(outside, link, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      const target = path.join(link, 'sub', 'out');
      assert.throws(
        () => assertRealpathContainment(target, tmp.path),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('resolves a symlinked ancestor to its real destination inside the root', (t) => {
    const tmp = makeTempDir();
    try {
      // `link` -> `real`, both inside the root: the target resolves to
      // real/sub/out, which is inside the root, so this is allowed. The
      // escape variant (symlink pointing outside) is covered by the
      // previous test. This pins the old deepest-existing escape hole:
      // containment is evaluated through the symlinked prefix, not lexically.
      const real = path.join(tmp.path, 'real');
      const link = path.join(tmp.path, 'link');
      fs.mkdirSync(path.join(real, 'sub'), { recursive: true });
      let made = false;
      try {
        fs.symlinkSync(real, link, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      const target = path.join(link, 'sub', 'out');
      const realTarget = assertRealpathContainment(target, tmp.path);
      assert.equal(realTarget, path.join(real, 'sub', 'out'));
    } finally {
      tmp.cleanup();
    }
  });

  test('safeRealpath falls back to the resolved path for missing targets', () => {
    const missing = path.join(os.tmpdir(), 'cai-missing', 'deep', 'target');
    assert.equal(safeRealpath(missing), path.resolve(missing));
  });
});

describe('assertCliOutputPolicy', () => {
  const cwd = path.resolve(process.platform === 'win32' ? 'C:\\work' : '/work');
  const repo = path.resolve(process.platform === 'win32' ? 'C:\\repo' : '/repo');

  test('relative outputs must stay inside cwd', () => {
    assert.throws(
      () => assertCliOutputPolicy(path.join('..', '..', 'escape'), { cwd, repoRoot: null }),
      (err) => err.code === 'E_UNSAFE_PATH',
    );
    const ok = assertCliOutputPolicy(path.join('sub', 'dir'), { cwd, repoRoot: null });
    assert.ok(ok.startsWith(path.resolve(cwd)));
  });

  test('rejects filesystem root, home dir and repo root', () => {
    const home = os.homedir();
    assert.throws(() => assertCliOutputPolicy(path.parse(cwd).root, { cwd }), (err) => err.code === 'E_UNSAFE_PATH');
    assert.throws(() => assertCliOutputPolicy(home, { cwd }), (err) => err.code === 'E_UNSAFE_PATH');
    assert.throws(() => assertCliOutputPolicy(repo, { cwd, repoRoot: repo }), (err) => err.code === 'E_UNSAFE_PATH');
  });

  test('absolute subpaths outside cwd are allowed (user preference) but roots are not', () => {
    const abs = path.resolve(path.join(path.parse(cwd).root, 'elsewhere', 'my-app'));
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

  test('refuses a symlinked OUTPUT path even when its destination is inside the root', (t) => {
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
      // The chain resolves inside the root, but the OUTPUT itself is a
      // symlink: generated content must land in the directory the user
      // chose, not where the link points, so it is refused.
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

      // existsSync-following behavior is gone: without --force the symlink is
      // still REFUSED (it looks like an existing file to a stat-based check,
      // but lstat reveals the link) — never silently skipped, never written.
      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
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

  test('a broken symlink at a planned file path is refused without --force', (t) => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      fs.mkdirSync(out);
      let made = false;
      try {
        // Symlink to a target that does not exist: existsSync would report
        // false and the old code would have "created" through the link.
        fs.symlinkSync(path.join(tmp.path, 'missing-target'), path.join(out, 'README.md'), 'file');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);

      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path, force: true }),
        (err) => err.code === 'E_UNSAFE_PATH',
      );
      assert.equal(fs.existsSync(path.join(tmp.path, 'missing-target')), false, 'dangling target must not be created');
    } finally {
      tmp.cleanup();
    }
  });

  test('a directory occupying a planned file path is E_TARGET_EXISTS, not raw EISDIR', () => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      fs.mkdirSync(path.join(out, 'README.md'), { recursive: true });
      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path, force: true }),
        (err) => err.code === 'E_TARGET_EXISTS' && /directory/.test(err.message),
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('a file occupying a planned directory path is E_TARGET_EXISTS', () => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      fs.mkdirSync(out);
      fs.writeFileSync(path.join(out, 'docs'), 'a regular file', 'utf8');
      assert.throws(
        () => generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_TARGET_EXISTS' && /docs/.test(err.message),
      );
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

  test('refuses an output path through a symlink that points OUTSIDE the allowed root', (t) => {
    const tmp = makeTempDir();
    try {
      // --output link/sub/out where `link` points to a directory OUTSIDE the
      // allowed root: realpath containment must catch the escape even though
      // the deepest existing entry (real/sub) is inside the root.
      const real = path.join(tmp.path, 'real');
      const outside = path.join(path.dirname(tmp.path), 'cai-outside-real');
      const link = path.join(tmp.path, 'link');
      fs.mkdirSync(path.join(real, 'sub'), { recursive: true });
      let made = false;
      try {
        fs.symlinkSync(outside, link, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);

      const target = path.join(link, 'sub', 'out');
      try {
        assert.throws(
          () => generateSkeleton(fixtureStack(), target, { allowedRoot: tmp.path }),
          (err) => err.code === 'E_UNSAFE_PATH',
        );
        // Nothing may have been written through the symlink: `outside` was
        // never created (it does not exist beforehand), or stays empty.
        const outsideEntries = fs.existsSync(outside) ? fs.readdirSync(outside) : [];
        assert.deepEqual(outsideEntries, [], 'no writes through the escaping symlink');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      tmp.cleanup();
    }
  });
});
