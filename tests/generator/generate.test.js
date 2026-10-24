// Tests for skeleton generation: happy path, dry-run, idempotency, --force, stack.json shape.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateSkeleton,
  renderStackJson,
  renderReadme,
  planGeneration,
  checkStackId,
  SKELETON_DIRS,
} from '../../packages/generator/lib/generate.js';
import { makeCatalog, makeTempDir } from './helpers.js';

function fixtureStack(overrides = {}) {
  return {
    id: '08-fixture-stack-8',
    number: 8,
    category: 'fixture-category',
    maturity: 'proposed',
    ...overrides,
  };
}

describe('checkStackId', () => {
  test('accepts well-formed ids', () => {
    for (const id of ['01-java25-springboot-react-flutter', '40-python-fastapi-websockets-threejs', '08-supabase-react-vite']) {
      assert.equal(checkStackId(id).ok, true, id);
    }
  });

  test('rejects malformed ids with E_INVALID_STACK', () => {
    for (const id of ['', null, undefined, 'no-number', '8-short', '01-UPPER', '01-double--hyphen', '../../evil', '01-a/b']) {
      const result = checkStackId(id);
      assert.equal(result.ok, false, String(id));
      assert.equal(result.code, 'E_INVALID_STACK', String(id));
    }
  });
});

describe('renderers', () => {
  test('stack.json is deterministic and manifest-shaped', () => {
    const stack = fixtureStack();
    const a = renderStackJson(stack);
    const b = renderStackJson(fixtureStack());
    assert.equal(a, b, 'rendering must be deterministic');
    const parsed = JSON.parse(a);
    assert.equal(parsed.id, '08-fixture-stack-8');
    assert.equal(parsed.maturity, 'proposed');
    assert.equal(parsed.verification.manifest, false);
    assert.deepEqual(parsed.requires, []);
  });

  test('README derives a title from the id and warns about skeleton status', () => {
    const readme = renderReadme(fixtureStack({ id: '01-java25-springboot-react-flutter' }));
    assert.match(readme, /# Java25 Springboot React Flutter/);
    assert.match(readme, /production-ready/i);
    assert.match(readme, /\*\*not\*\* production-ready/);
  });

  test('plan contains README, stack.json and empty dirs only', () => {
    const plan = planGeneration(fixtureStack(), 'X:\\out');
    assert.deepEqual(
      plan.files.map((f) => f.path).sort(),
      ['README.md', 'stack.json'],
    );
    for (const dir of SKELETON_DIRS) {
      assert.ok(plan.dirs.includes(dir));
    }
  });
});

describe('generateSkeleton happy path', () => {
  test('creates README, stack.json and empty directories inside the output', () => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'generated');
      const report = generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path });
      assert.deepEqual(report.created.sort(), ['README.md', 'stack.json']);
      assert.equal(report.skipped.length, 0);
      assert.ok(fs.existsSync(path.join(out, 'README.md')));
      assert.ok(fs.existsSync(path.join(out, 'stack.json')));
      for (const dir of SKELETON_DIRS) {
        assert.ok(fs.existsSync(path.join(out, dir)), dir);
        assert.deepEqual(fs.readdirSync(path.join(out, dir)), [], `${dir} must be empty`);
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(out, 'stack.json'), 'utf8'));
      assert.equal(manifest.id, '08-fixture-stack-8');
      assert.equal(manifest.name, 'Fixture Stack 8');
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects unknown stack ids before touching the disk', () => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'never-created');
      assert.throws(
        () => generateSkeleton({ id: '../../evil' }, out, { allowedRoot: tmp.path }),
        (err) => err.code === 'E_INVALID_STACK',
      );
      assert.equal(fs.existsSync(out), false, 'no directory may be created for an invalid stack');
    } finally {
      tmp.cleanup();
    }
  });
});

describe('idempotency and overwrite protection', () => {
  test('second run without --force skips existing files and preserves their content', () => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path });
      const userMarker = 'USER CONTENT — must survive';
      fs.writeFileSync(path.join(out, 'README.md'), userMarker, 'utf8');

      const report = generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path });
      assert.deepEqual(report.created, []);
      assert.deepEqual(report.skipped.sort(), ['README.md', 'stack.json']);
      assert.equal(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), userMarker, 'existing file must not be touched');
    } finally {
      tmp.cleanup();
    }
  });

  test('second run with --force overwrites tracked files only', () => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'proj');
      generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path });
      fs.writeFileSync(path.join(out, 'untracked.txt'), 'keep me', 'utf8');

      const report = generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path, force: true });
      assert.deepEqual(report.forced.sort(), ['README.md', 'stack.json']);
      assert.equal(fs.readFileSync(path.join(out, 'untracked.txt'), 'utf8'), 'keep me', 'untracked files must survive --force');
      assert.match(fs.readFileSync(path.join(out, 'README.md'), 'utf8'), /Fixture Stack 8/);
    } finally {
      tmp.cleanup();
    }
  });

  test('generate is deterministic: two runs with --force produce identical bytes', () => {
    const tmp = makeTempDir();
    try {
      const outA = path.join(tmp.path, 'a');
      const outB = path.join(tmp.path, 'b');
      generateSkeleton(fixtureStack(), outA, { allowedRoot: tmp.path, force: true });
      generateSkeleton(fixtureStack(), outB, { allowedRoot: tmp.path, force: true });
      for (const file of ['README.md', 'stack.json']) {
        assert.equal(
          fs.readFileSync(path.join(outA, file), 'utf8'),
          fs.readFileSync(path.join(outB, file), 'utf8'),
          file,
        );
      }
    } finally {
      tmp.cleanup();
    }
  });
});

describe('dry-run', () => {
  test('plans but writes nothing', () => {
    const tmp = makeTempDir();
    try {
      const out = path.join(tmp.path, 'dry');
      const report = generateSkeleton(fixtureStack(), out, { allowedRoot: tmp.path, dryRun: true });
      assert.equal(report.dryRun, true);
      assert.ok(report.planned.includes('README.md'));
      assert.ok(report.planned.includes('stack.json'));
      assert.equal(fs.existsSync(out), false, 'dry-run must not create the output directory');
    } finally {
      tmp.cleanup();
    }
  });
});

describe('catalog-driven generation', () => {
  test('uses real catalog fields in the generated manifest', () => {
    const tmp = makeTempDir();
    try {
      const catalog = makeCatalog({ count: 40 });
      const stack = catalog.stacks[19];
      const out = path.join(tmp.path, 'from-catalog');
      generateSkeleton(stack, out, { allowedRoot: tmp.path });
      const manifest = JSON.parse(fs.readFileSync(path.join(out, 'stack.json'), 'utf8'));
      assert.equal(manifest.id, stack.id);
      assert.equal(manifest.category, stack.category);
      assert.equal(manifest.maturity, stack.maturity);
    } finally {
      tmp.cleanup();
    }
  });
});
