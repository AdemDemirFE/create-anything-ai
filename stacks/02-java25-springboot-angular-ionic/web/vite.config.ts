import { defineConfig } from 'vitest/config';

/**
 * Unit-test runner for the Angular web client. Components are exercised with
 * the real @angular/core via vitest + jsdom; network calls are mocked at the
 * fetch boundary so tests assert BEHAVIOR (envelope handling, error mapping,
 * polling cadence) without a running backend. The wire format is verified
 * end-to-end by the backend integration suite.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
