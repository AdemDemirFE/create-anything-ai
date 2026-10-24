// Tests for catalog parsing, validation and the list/status/validate commands.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCatalog,
  validateCatalog,
  parseCatalog,
  titleFromId,
  REQUIRED_STACK_COUNT,
  MATURITY_VALUES,
} from '../../packages/generator/lib/catalog.js';
import {
  loadCatalogFromDisk,
  listCommand,
  validateCommand,
  statusCommand,
  requireStack,
} from '../../packages/generator/lib/commands.js';
import { makeCatalog, catalogJson, writeFixtureCatalog, makeTempDir, realCatalogPath, realCatalogExists } from './helpers.js';
import fs from 'node:fs';

describe('catalog parsing', () => {
  test('parses a valid catalog JSON', () => {
    const parsed = parseCatalog(catalogJson(makeCatalog()));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.catalog.stacks.length, 40);
  });

  test('rejects invalid JSON with E_CATALOG_INVALID', () => {
    const parsed = parseCatalog('{not json');
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors[0], /E_CATALOG_INVALID/);
  });
});

describe('catalog validation', () => {
  test('accepts a catalog with exactly 40 unique stacks and valid maturities', () => {
    const result = validateCatalog(makeCatalog());
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  test('rejects when stack count is not 40 (E_COUNT_MISMATCH)', () => {
    const result = validateCatalog(makeCatalog({ count: 39 }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('E_COUNT_MISMATCH')));
  });

  test('rejects duplicate ids (E_ID_DUPLICATE)', () => {
    const catalog = makeCatalog();
    catalog.stacks[5].id = catalog.stacks[4].id;
    const result = validateCatalog(catalog);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('E_ID_DUPLICATE')));
  });

  test('rejects invalid maturity (E_MATURITY_INVALID)', () => {
    const catalog = makeCatalog();
    catalog.stacks[0].maturity = 'super-stable';
    const result = validateCatalog(catalog);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('E_MATURITY_INVALID')));
  });

  test('rejects malformed ids (E_ID_INVALID)', () => {
    const catalog = makeCatalog();
    catalog.stacks[0].id = 'Not-A-Valid-Id';
    const result = validateCatalog(catalog);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('E_ID_INVALID')));
  });

  test('rejects non-object roots and missing stacks array', () => {
    assert.equal(validateCatalog(null).ok, false);
    assert.equal(validateCatalog([1, 2, 3]).ok, false);
    assert.equal(validateCatalog({}).ok, false);
  });

  test('rejects missing category or number', () => {
    const catalog = makeCatalog();
    delete catalog.stacks[2].category;
    delete catalog.stacks[3].number;
    const result = validateCatalog(catalog);
    assert.equal(result.ok, false);
    assert.ok(result.errors.filter((e) => e.includes('E_CATALOG_INVALID')).length >= 2);
  });

  test('exposes the documented policy constants', () => {
    assert.equal(REQUIRED_STACK_COUNT, 40);
    assert.ok(MATURITY_VALUES.includes('proposed'));
    assert.ok(MATURITY_VALUES.includes('blocked'));
  });
});

describe('loadCatalog end-to-end', () => {
  test('loads a valid catalog', () => {
    const loaded = loadCatalog(catalogJson(makeCatalog()));
    assert.equal(loaded.ok, true);
    assert.equal(loaded.stacks.length, 40);
  });

  test('aggregates validation errors', () => {
    const catalog = makeCatalog({ count: 2 });
    catalog.stacks[0].maturity = 'nope';
    const loaded = loadCatalog(catalogJson(catalog));
    assert.equal(loaded.ok, false);
    assert.ok(loaded.errors.some((e) => e.includes('E_COUNT_MISMATCH')));
    assert.ok(loaded.errors.some((e) => e.includes('E_MATURITY_INVALID')));
  });
});

describe('commands: list / validate / status / requireStack', () => {
  test('list renders all 40 stacks in order', () => {
    const catalog = makeCatalog();
    const out = listCommand(catalog);
    const lines = out.split('\n');
    assert.equal(lines.length, 40);
    assert.match(lines[0], /^01\. 01-fixture-stack-1 \[proposed\] fixture-category$/);
    assert.match(lines[39], /^40\. 40-fixture-stack-40 \[proposed\] fixture-category$/);
  });

  test('validate summarizes counts', () => {
    const catalog = makeCatalog({ maturities: ['proposed', 'blocked'] });
    const out = validateCommand(catalog);
    assert.match(out, /Validated 40 stacks/);
    assert.match(out, /proposed=20/);
    assert.match(out, /blocked=20/);
  });

  test('status shows catalog version, categories and next number', () => {
    const catalog = makeCatalog();
    const out = statusCommand(catalog);
    assert.match(out, /Stacks: 40/);
    assert.match(out, /Next number: 41/);
    assert.match(out, /fixture-category/);
  });

  test('requireStack finds existing stack', () => {
    const catalog = makeCatalog();
    const stack = requireStack(catalog, '07-fixture-stack-7');
    assert.equal(stack.number, 7);
  });

  test('requireStack rejects unknown id with E_INVALID_STACK', () => {
    const catalog = makeCatalog();
    assert.throws(
      () => requireStack(catalog, '99-unknown'),
      (err) => err.code === 'E_INVALID_STACK' && /99-unknown/.test(err.message),
    );
  });

  test('requireStack rejects syntactically invalid ids', () => {
    const catalog = makeCatalog();
    for (const bad of ['../etc/passwd', '', null, '01_Underscore', '01-UPPER']) {
      assert.throws(() => requireStack(catalog, bad), (err) => err.code === 'E_INVALID_STACK');
    }
  });
});

describe('loadCatalogFromDisk', () => {
  test('reads a fixture catalog from disk', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path, makeCatalog());
      const catalog = loadCatalogFromDisk(catalogPath);
      assert.equal(catalog.stacks.length, 40);
    } finally {
      tmp.cleanup();
    }
  });

  test('throws E_CATALOG_INVALID for a missing file', () => {
    assert.throws(
      () => loadCatalogFromDisk('Z:/definitely/not/here/catalog.json'),
      (err) => err.code === 'E_CATALOG_INVALID',
    );
  });

  test('throws E_CATALOG_INVALID for a broken catalog', () => {
    const tmp = makeTempDir();
    try {
      const catalogPath = writeFixtureCatalog(tmp.path);
      fs.writeFileSync(catalogPath, '{"stacks": [', 'utf8');
      assert.throws(
        () => loadCatalogFromDisk(catalogPath),
        (err) => err.code === 'E_CATALOG_INVALID',
      );
    } finally {
      tmp.cleanup();
    }
  });
});

describe('real repository catalog (read-only smoke)', () => {
  test('validates the actual stacks/catalog.json when present', () => {
    if (!realCatalogExists()) {
      return; // stacks/ is owned by another worker; skip in this checkout.
    }
    const catalog = loadCatalogFromDisk(realCatalogPath());
    assert.equal(catalog.stacks.length, 40);
    const ids = new Set(catalog.stacks.map((s) => s.id));
    assert.equal(ids.size, 40);
  });
});
