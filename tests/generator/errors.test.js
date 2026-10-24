// Tests for the stable error-code helpers that the CLI entrypoint relies on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CODES, errorWithCode, exitCodeFor, formatError } from '../../packages/generator/lib/errors.js';

describe('ERROR_CODES mapping', () => {
  test('documents the contract exit codes', () => {
    assert.equal(ERROR_CODES.E_INVALID_STACK, 1);
    assert.equal(ERROR_CODES.E_TARGET_EXISTS, 2);
    assert.equal(ERROR_CODES.E_UNSAFE_PATH, 3);
    assert.equal(ERROR_CODES.E_CATALOG_INVALID, 4);
    assert.equal(ERROR_CODES.E_USAGE, 64);
    assert.equal(ERROR_CODES.E_IO, 74);
  });

  test('catalog rule codes share exit code 4', () => {
    for (const code of ['E_COUNT_MISMATCH', 'E_ID_INVALID', 'E_ID_DUPLICATE', 'E_MATURITY_INVALID']) {
      assert.equal(ERROR_CODES[code], 4, code);
    }
  });
});

describe('exitCodeFor (single source used by the CLI entrypoint)', () => {
  test('maps known codes to their contract exit codes', () => {
    assert.equal(exitCodeFor(errorWithCode('E_INVALID_STACK', 'x')), 1);
    assert.equal(exitCodeFor(errorWithCode('E_UNSAFE_PATH', 'x')), 3);
    assert.equal(exitCodeFor(errorWithCode('E_CATALOG_INVALID', 'x')), 4);
    assert.equal(exitCodeFor(errorWithCode('E_USAGE', 'x')), 64);
  });

  test('falls back to E_IO (74) for unknown or missing codes', () => {
    assert.equal(exitCodeFor(errorWithCode('E_SOMETHING_NEW', 'x')), 74);
    assert.equal(exitCodeFor(new Error('plain error')), 74);
    assert.equal(exitCodeFor(undefined), 74);
    assert.equal(exitCodeFor('weird'), 74);
  });
});

describe('formatError (single source used by the CLI entrypoint)', () => {
  test('formats as CODE: message', () => {
    assert.equal(formatError(errorWithCode('E_UNSAFE_PATH', 'nope')), 'E_UNSAFE_PATH: nope');
  });

  test('falls back to E_IO prefix and never includes a stack trace', () => {
    const out = formatError(new Error('boom'));
    assert.equal(out, 'E_IO: boom');
    assert.doesNotMatch(out, /\n/);
  });

  test('handles non-Error values', () => {
    assert.equal(formatError('plain string'), 'E_IO: plain string');
  });
});
