// Command implementations shared by the CLI binary and tests.

import fs from 'node:fs';
import { loadCatalog, titleFromId } from './catalog.js';
import { generateSkeleton, checkStackId } from './generate.js';
import { errorWithCode } from './errors.js';

/** Load the catalog from disk and throw E_CATALOG_INVALID-compatible errors on failure. */
export function loadCatalogFromDisk(catalogPath) {
  let raw;
  try {
    raw = fs.readFileSync(catalogPath, 'utf8');
  } catch (err) {
    throw errorWithCode('E_CATALOG_INVALID', `E_CATALOG_INVALID: Cannot read catalog at ${catalogPath}: ${err.message}`);
  }
  const loaded = loadCatalog(raw);
  if (!loaded.ok) {
    const err = errorWithCode('E_CATALOG_INVALID', loaded.errors.join('; '));
    err.details = loaded.errors;
    throw err;
  }
  return loaded.catalog;
}

/** Find a stack by id in a validated catalog; throws E_INVALID_STACK when absent. */
export function requireStack(catalog, stackId) {
  const check = checkStackId(stackId);
  if (!check.ok) {
    throw errorWithCode(check.code, check.message);
  }
  const stack = (catalog.stacks ?? []).find((s) => s && s.id === stackId);
  if (!stack) {
    throw errorWithCode(
      'E_INVALID_STACK',
      `Unknown stack id "${stackId}". Run "create-anything-ai list" to see available stacks.`,
    );
  }
  return stack;
}

/** Human-readable one-line summary for a stack. */
export function formatStackLine(stack) {
  return `${String(stack.number).padStart(2, '0')}. ${stack.id} [${stack.maturity}] ${stack.category}`;
}

/** Compose the "list" command output (string, no trailing newline). */
export function listCommand(catalog) {
  return catalog.stacks.map(formatStackLine).join('\n');
}

/** Count stacks per maturity. */
function countMaturities(stacks) {
  const maturities = {};
  for (const s of stacks) {
    maturities[s.maturity] = (maturities[s.maturity] ?? 0) + 1;
  }
  return maturities;
}

/** Compose the "validate" command output. */
export function validateCommand(catalog) {
  const stacks = catalog.stacks ?? [];
  const categories = [...new Set(stacks.map((s) => s.category))].sort();
  const maturities = countMaturities(stacks);
  const maturitySummary = Object.entries(maturities)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return [
    `Validated ${stacks.length} stacks in catalog v${catalog.catalogVersion ?? '?'} (schema ${catalog.schemaVersion ?? '?'})`,
    `Categories: ${categories.length}`,
    `Maturity: ${maturitySummary}`,
  ].join('\n');
}

/** Compose the "status" command output (catalog summary). */
export function statusCommand(catalog) {
  const stacks = catalog.stacks ?? [];
  const categories = [...new Set(stacks.map((s) => s.category))].sort();
  const maturities = countMaturities(stacks);
  const maturitySummary = Object.entries(maturities)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const maxNumber = stacks.reduce((max, s) => Math.max(max, s.number ?? 0), 0);
  return [
    `Catalog: v${catalog.catalogVersion ?? '?'} (schema ${catalog.schemaVersion ?? '?'})`,
    `Stacks: ${stacks.length}`,
    `Categories (${categories.length}): ${categories.join(', ')}`,
    `Maturity: ${maturitySummary}`,
    `Next number: ${maxNumber + 1}`,
  ].join('\n');
}
