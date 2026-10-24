import { defineConfig } from 'vitest/config'

// The Mongo engine is REAL (mongodb-memory-server downloads and runs a mongod
// in-process). A single fork keeps exactly one mongod alive for the whole
// suite; each test file uses its own database name for isolation.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
