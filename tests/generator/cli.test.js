// End-to-end CLI tests: spawn the real binary and assert stdout, stderr and exit codes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCatalog, catalogJson, writeFixtureCatalog, makeTempDir } from './helpers.js';

const CLI = fileURLToPath(new URL('../../packages/generator/bin/create-anything-ai.js', import.meta.url));

/**
 * Run the CLI with arguments; returns { status, stdout, stderr }.
 * Never uses a shell: argv array only (no command injection surface).
 */
function runCli(args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd,
    shell: false,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('CLI: help and version', () => {
  test('--help prints usage and exits 0', () => {
    const { status, stdout } = runCli(['--help']);
    assert.equal(status, 0);
    assert.match(stdout, /Usage:/);
    assert.match(stdout, /generate <stack-id>/);
  });

  test('--version prints a semver', () => {
    const { status, stdout } = runCli(['--version']);
    assert.equal(status, 0);
    assert.match(stdout, /^\d+\.\d+\.\d+/);
  });

  test('unknown command exits non-zero with E_USAGE on stderr', () => {
    const { status, stderr } = runCli(['frobnicate']);
    assert.notEqual(status, 0);
    assert.match(stderr, /E_USAGE/);
  });

  test('unknown option exits non-zero with E_USAGE', () => {
    const { status, stderr } = runCli(['list', '--bogus-flag']);
    assert.notEqual(status, 0);
    assert.match(stderr, /E_USAGE/);
  });
});

describe('CLI: list / validate / status with a fixture catalog', () => {
  test('list prints 40 numbered stacks and exits 0', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const { status, stdout } = runCli(['--catalog', catalogPath, 'list']);
      assert.equal(status, 0);
      const lines = stdout.trim().split('\n');
      assert.equal(lines.length, 40);
      assert.match(lines[0], /^01\. 01-fixture-stack-1 \[proposed\]/);
    } finally {
      tmp.cleanup();
    }
  });

  test('validate exits 0 for a valid catalog', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const { status, stdout } = runCli(['--catalog', catalogPath, 'validate']);
      assert.equal(status, 0);
      assert.match(stdout, /Validated 40 stacks/);
    } finally {
      tmp.cleanup();
    }
  });

  test('validate exits non-zero with E_COUNT_MISMATCH for a short catalog', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog({ count: 12 }));
      const { status, stderr } = runCli(['--catalog', catalogPath, 'validate']);
      assert.notEqual(status, 0);
      assert.match(stderr, /E_COUNT_MISMATCH/);
    } finally {
      tmp.cleanup();
    }
  });

  test('status prints catalog summary and exits 0', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const { status, stdout } = runCli(['--catalog', catalogPath, 'status']);
      assert.equal(status, 0);
      assert.match(stdout, /Stacks: 40/);
      assert.match(stdout, /Next number: 41/);
    } finally {
      tmp.cleanup();
    }
  });

  test('a corrupted catalog fails with E_CATALOG_INVALID', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path);
      fs.writeFileSync(catalogPath, '{broken', 'utf8');
      const { status, stderr } = runCli(['--catalog', catalogPath, 'list']);
      assert.notEqual(status, 0);
      assert.match(stderr, /E_CATALOG_INVALID/);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('CLI: error handling single source of truth', () => {
  test('catalog read failure exits 4 with single CODE: prefix from lib/errors.js', () => {
    const tmp = makeTempDir();
    try {
      // Point --catalog at a directory: readSync fails with EISDIR and the
      // CLI must surface E_CATALOG_INVALID (exit 4) with exactly one
      // "CODE: " prefix (no duplicated prefixes, no stack trace).
      const { status, stderr } = runCli(['--catalog', tmp.path, 'list']);
      assert.equal(status, 4, `expected exit 4, got stderr: ${stderr}`);
      assert.match(stderr, /^E_CATALOG_INVALID: /, 'stderr uses CODE: message format');
      assert.equal((stderr.match(/E_CATALOG_INVALID:/g) ?? []).length, 1, 'code prefix must not be duplicated');
      assert.doesNotMatch(stderr, /at .+:\d+:\d+/, 'no stack trace on stderr');
    } finally {
      tmp.cleanup();
    }
  });

  test('E_USAGE exits 64 and E_INVALID_STACK exits 1 with CODE: message format', () => {
    const usage = runCli(['no-such-command']);
    assert.equal(usage.status, 64);
    assert.match(usage.stderr, /^E_USAGE: /);

    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const invalid = runCli(['--catalog', catalogPath, 'generate', 'bad id', '--output', 'x']);
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /^E_INVALID_STACK: /);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('CLI: generate', () => {
  test('generates a skeleton from a valid stack id', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const out = path.join(tmp.path, 'proj');
      const { status, stdout } = runCli(['--catalog', catalogPath, 'generate', '05-fixture-stack-5', '--output', out]);
      assert.equal(status, 0);
      assert.match(stdout, /created: README\.md/);
      assert.ok(fs.existsSync(path.join(out, 'stack.json')));
      const dirs = fs.readdirSync(out);
      assert.ok(dirs.includes('backend') && dirs.includes('web'));
    } finally {
      tmp.cleanup();
    }
  });

  test('unknown stack id is rejected safely: exit 1, E_INVALID_STACK, nothing written', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const out = path.join(tmp.path, 'never');
      const { status, stderr } = runCli(['--catalog', catalogPath, 'generate', '99-not-in-catalog', '--output', out]);
      assert.equal(status, 1);
      assert.match(stderr, /E_INVALID_STACK/);
      assert.equal(fs.existsSync(out), false, 'output directory must not be created');
    } finally {
      tmp.cleanup();
    }
  });

  test('missing --output fails with E_USAGE', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const { status, stderr } = runCli(['--catalog', catalogPath, 'generate', '01-fixture-stack-1']);
      assert.notEqual(status, 0);
      assert.match(stderr, /E_USAGE/);
    } finally {
      tmp.cleanup();
    }
  });

  test('re-run without --force exits 0 and skips existing files (idempotent)', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const out = path.join(tmp.path, 'proj');
      runCli(['--catalog', catalogPath, 'generate', '03-fixture-stack-3', '--output', out]);
      const second = runCli(['--catalog', catalogPath, 'generate', '03-fixture-stack-3', '--output', out]);
      assert.equal(second.status, 0);
      assert.match(second.stdout, /skipped \(exists, use --force to overwrite\): README\.md/);
    } finally {
      tmp.cleanup();
    }
  });

  test('--force overwrites existing skeleton files', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const out = path.join(tmp.path, 'proj');
      runCli(['--catalog', catalogPath, 'generate', '03-fixture-stack-3', '--output', out]);
      const forced = runCli(['--catalog', catalogPath, 'generate', '03-fixture-stack-3', '--output', out, '--force']);
      assert.equal(forced.status, 0);
      assert.match(forced.stdout, /overwritten \(--force\): README\.md/);
    } finally {
      tmp.cleanup();
    }
  });

  test('--dry-run writes nothing but prints the plan', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const out = path.join(tmp.path, 'dry-run-proj');
      const { status, stdout } = runCli(['--catalog', catalogPath, 'generate', '09-fixture-stack-9', '--output', out, '--dry-run']);
      assert.equal(status, 0);
      assert.match(stdout, /dry-run: no files were written/);
      assert.equal(fs.existsSync(out), false);
    } finally {
      tmp.cleanup();
    }
  });

  test('relative traversal output is rejected with E_UNSAFE_PATH', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const workDir = path.join(tmp.path, 'work');
      fs.mkdirSync(workDir);
      const { status, stderr } = runCli(
        ['--catalog', catalogPath, 'generate', '01-fixture-stack-1', '--output', path.join('..', 'escaped')],
        { cwd: workDir },
      );
      assert.equal(status, 3);
      assert.match(stderr, /E_UNSAFE_PATH/);
      assert.equal(fs.existsSync(path.join(tmp.path, 'escaped')), false);
    } finally {
      tmp.cleanup();
    }
  });

  test('symlink ancestor inside cwd pointing OUTSIDE cwd is refused end-to-end (E_UNSAFE_PATH)', (t) => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const work = path.join(tmp.path, 'work');
      fs.mkdirSync(work);
      // A symlink inside the cwd that resolves OUTSIDE the cwd: a relative
      // --output through it must be refused (containment is enforced against
      // the cwd for relative outputs) and nothing may be written outside.
      const outside = path.join(path.dirname(tmp.path), `cai-cli-outside-${process.pid}`);
      fs.mkdirSync(outside, { recursive: true });
      const link = path.join(work, 'evil-link');
      let made = false;
      try {
        fs.symlinkSync(outside, link, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      try {
        const { status, stderr } = runCli(
          ['--catalog', catalogPath, 'generate', '01-fixture-stack-1', '--output', path.join('evil-link', 'proj')],
          { cwd: work },
        );
        assert.equal(status, 3);
        assert.match(stderr, /E_UNSAFE_PATH/);
        const outsideEntries = fs.existsSync(outside) ? fs.readdirSync(outside) : [];
        assert.deepEqual(outsideEntries, [], 'nothing may be written outside cwd through the symlink');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      tmp.cleanup();
    }
  });

  test('benign symlinked ancestor is allowed for absolute outputs (macOS /tmp style)', (t) => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      // macOS /tmp -> /private/tmp analogue: the output sits BEHIND a
      // symlinked ancestor; that must stay allowed and the files must land
      // in the real destination behind the link.
      const realBase = path.join(tmp.path, 'private-tmp');
      fs.mkdirSync(realBase, { recursive: true });
      const linkBase = path.join(tmp.path, 'tmp-link');
      let made = false;
      try {
        fs.symlinkSync(realBase, linkBase, 'dir');
        made = true;
      } catch {
        t.skip('symlinks not permitted on this host');
        return;
      }
      assert.ok(made);
      const out = path.join(linkBase, 'proj');
      const { status, stdout } = runCli(['--catalog', catalogPath, 'generate', '05-fixture-stack-5', '--output', out]);
      assert.equal(status, 0);
      assert.match(stdout, /created: README\.md/);
      assert.ok(fs.existsSync(path.join(realBase, 'proj', 'stack.json')), 'files land behind the link');
    } finally {
      tmp.cleanup();
    }
  });
});
