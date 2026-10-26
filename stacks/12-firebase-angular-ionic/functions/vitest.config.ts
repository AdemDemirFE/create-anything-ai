/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolve extensionless './x' imports the way tsc's "node" resolution
  // does (tests import TS sources directly; no build step in the loop).
  esbuild: {
    loader: 'ts',
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Emulator bootstrapping is serial and stateful; never shard files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
