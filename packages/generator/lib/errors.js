// Stable error codes for the generator CLI (see docs/GENERATOR_CONTRACT.md).
// The contract lists suggested codes; we map them onto small exit-code ranges.

export const ERROR_CODES = Object.freeze({
  E_INVALID_STACK: 1, // unknown or malformed stack id
  E_TARGET_EXISTS: 2, // non-empty target without --force
  E_UNSAFE_PATH: 3, // path traversal / output outside allowed root
  E_CATALOG_INVALID: 4, // catalog unreadable or structurally invalid
  E_COUNT_MISMATCH: 4, // catalog stack count != 40
  E_ID_INVALID: 4, // catalog entry with malformed id
  E_ID_DUPLICATE: 4, // catalog entry with duplicate id
  E_MATURITY_INVALID: 4, // catalog entry with invalid maturity
  E_USAGE: 64, // command-line usage error (EX_USAGE convention)
  E_IO: 74, // unexpected filesystem I/O failure (EX_IOERR convention)
});

/** Build an Error carrying a stable code for exit-code mapping. */
export function errorWithCode(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Exit code for an error (defaults to generic failure). */
export function exitCodeFor(err) {
  if (err && typeof err.code === 'string' && ERROR_CODES[err.code] !== undefined) {
    return ERROR_CODES[err.code] ?? 1;
  }
  return 1;
}

/** Format an error for stderr: code + message, never a stack trace. */
export function formatError(err) {
  const code = err && typeof err.code === 'string' ? err.code : 'E_IO';
  return `${code}: ${err && err.message ? err.message : String(err)}`;
}
