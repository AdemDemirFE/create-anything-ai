import 'reflect-metadata'
import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  // SWC transform keeps `emitDecoratorMetadata` intact under vitest (esbuild
  // drops it, which breaks NestJS DI + class-validator metadata at runtime).
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        baseUrl: '.',
      },
    }),
  ],
  test: {
    // One process, one REAL SQLite database per test file (see helpers).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
