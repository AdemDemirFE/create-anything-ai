/// <reference types="vitest" />
import { resolve } from 'node:path'
import angular from '@analogjs/vite-plugin-angular'
import { defineConfig } from 'vitest/config'

// Angular 19 + Ionic 8 unit tests run in jsdom via the Analog vitest plugin.
// Zone.js setup wraps the GLOBAL describe/it so specs run inside the Angular
// zone — Analog requires globals: true for that; specs may still import
// from 'vitest' explicitly, both styles work side by side.
export default defineConfig({
  plugins: [
    angular({
      tsconfig: resolve(import.meta.dirname, 'tsconfig.spec.json'),
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    // Ionic ships ESM inside a CJS package — vitest must inline/transform it.
    server: {
      deps: {
        inline: ['@ionic/core', '@ionic/angular'],
      },
    },
  },
})
