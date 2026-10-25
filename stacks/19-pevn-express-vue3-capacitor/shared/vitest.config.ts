import { defineConfig } from 'vitest/config'

// Shared layer tests run in plain Node: envelope normalization + client
// behavior with mocked transports. This suite doubles as the Capacitor
// shell verification (the shell imports exactly these sources).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
