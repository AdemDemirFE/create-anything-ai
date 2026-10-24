// Catalog loading and validation for the Create Anything AI generator CLI.
// Pure functions only: no I/O here (loadCatalog receives raw text from the caller).

/** Stack id pattern shared with schemas/stack-manifest.schema.json. */
export const STACK_ID_PATTERN = /^[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Maturity values from the catalog maturity policy. */
export const MATURITY_VALUES = Object.freeze([
  'proposed',
  'spec-ready',
  'scaffolded',
  'verified',
  'production-reference',
  'blocked',
]);

/** Exact number of stacks the catalog must contain. */
export const REQUIRED_STACK_COUNT = 40;

/** Build a human-friendly title from a stack id like "01-java25-springboot-react-flutter". */
export function titleFromId(id) {
  const withoutNumber = id.replace(/^[0-9]{2}-/, '');
  return withoutNumber
    .split('-')
    .map((part) => (part === 'ai' ? 'AI' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/** Parse raw catalog text into JSON with a stable error code on failure. */
export function parseCatalog(rawText) {
  try {
    const data = JSON.parse(rawText);
    return { ok: true, catalog: data, errors: [] };
  } catch (err) {
    return {
      ok: false,
      catalog: null,
      errors: [`E_CATALOG_INVALID: catalog.json is not valid JSON (${err.message})`],
    };
  }
}

/**
 * Validate a parsed catalog object against the content rules:
 * - `stacks` must be an array of exactly REQUIRED_STACK_COUNT entries.
 * - ids must match STACK_ID_PATTERN and be unique.
 * - maturity must be one of MATURITY_VALUES.
 * Returns { ok, errors } with stable "E_*" error codes.
 */
export function validateCatalog(data) {
  const errors = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['E_CATALOG_INVALID: catalog root must be a JSON object'] };
  }

  const stacks = data.stacks;
  if (!Array.isArray(stacks)) {
    errors.push('E_CATALOG_INVALID: "stacks" must be an array');
    return { ok: false, errors };
  }

  if (stacks.length !== REQUIRED_STACK_COUNT) {
    errors.push(`E_COUNT_MISMATCH: catalog must contain exactly ${REQUIRED_STACK_COUNT} stacks, found ${stacks.length}`);
  }

  const seen = new Set();
  stacks.forEach((stack, index) => {
    const label = `stacks[${index}]`;
    if (!stack || typeof stack !== 'object' || Array.isArray(stack)) {
      errors.push(`E_CATALOG_INVALID: ${label} must be an object`);
      return;
    }
    if (typeof stack.id !== 'string' || !STACK_ID_PATTERN.test(stack.id)) {
      errors.push(`E_ID_INVALID: ${label} has invalid id ${JSON.stringify(stack.id ?? null)} (expected pattern NN-lowercase-hyphenated)`);
    } else if (seen.has(stack.id)) {
      errors.push(`E_ID_DUPLICATE: duplicate stack id "${stack.id}"`);
    } else {
      seen.add(stack.id);
    }
    if (!MATURITY_VALUES.includes(stack.maturity)) {
      errors.push(`E_MATURITY_INVALID: ${label} (${stack.id ?? '?'}) has invalid maturity ${JSON.stringify(stack.maturity ?? null)}`);
    }
    if (typeof stack.category !== 'string' || stack.category.length === 0) {
      errors.push(`E_CATALOG_INVALID: ${label} (${stack.id ?? '?'}) has missing or empty category`);
    }
    if (!Number.isInteger(stack.number)) {
      errors.push(`E_CATALOG_INVALID: ${label} (${stack.id ?? '?'}) has missing or non-integer number`);
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Load and validate the catalog from raw text.
 * Returns { ok, catalog, stacks, errors }.
 */
export function loadCatalog(rawText) {
  const parsed = parseCatalog(rawText);
  if (!parsed.ok) {
    return parsed;
  }
  const validated = validateCatalog(parsed.catalog);
  if (!validated.ok) {
    return { ok: false, catalog: parsed.catalog, stacks: null, errors: validated.errors };
  }
  return { ok: true, catalog: parsed.catalog, stacks: parsed.catalog.stacks, errors: [] };
}
