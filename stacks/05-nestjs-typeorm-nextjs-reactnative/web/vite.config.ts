import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Web-internal alias (tsconfig paths @/* -> ./src/*), used by pages.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The shared layer (API client + envelope) is consumed by both the web
      // app and the React Native wrapper — single source of truth.
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
  },
})
