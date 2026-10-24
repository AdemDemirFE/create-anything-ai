// Shared test helpers: fixture catalogs and temp directories.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Build a valid fixture catalog with `count` stacks (default 40). */
export function makeCatalog({ count = 40, maturities } = {}) {
  const stacks = [];
  for (let i = 1; i <= count; i++) {
    const nn = String(i).padStart(2, '0');
    stacks.push({
      id: `${nn}-fixture-stack-${i}`,
      number: i,
      category: 'fixture-category',
      maturity: maturities ? maturities[(i - 1) % maturities.length] : 'proposed',
    });
  }
  return {
    schemaVersion: '1.0.0',
    catalogVersion: '0.1.0',
    maturityPolicy: ['proposed', 'spec-ready', 'scaffolded', 'verified', 'production-reference', 'blocked'],
    stacks,
  };
}

/** Serialize a catalog object to a JSON string. */
export function catalogJson(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Create a unique temporary directory for a test; caller cleans up via the returned handle. */
export function makeTempDir(prefix = 'cai-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Write a fixture catalog into `<dir>/stacks/catalog.json`; returns the catalog path. */
export function writeFixtureCatalog(dir, catalog = makeCatalog()) {
  const stacksDir = path.join(dir, 'stacks');
  fs.mkdirSync(stacksDir, { recursive: true });
  const catalogPath = path.join(stacksDir, 'catalog.json');
  fs.writeFileSync(catalogPath, catalogJson(catalog), 'utf8');
  return catalogPath;
}

/** Absolute path of the CLI binary. */
export function cliPath() {
  return new URL('../../packages/generator/bin/create-anything-ai.js', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');
}

/** Absolute path of the real repository catalog (read-only input for smoke tests). */
export function realCatalogPath() {
  return new URL('../../stacks/catalog.json', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');
}

/** True when the real catalog exists in this checkout. */
export function realCatalogExists() {
  try {
    fs.accessSync(realCatalogPath());
    return true;
  } catch {
    return false;
  }
}
