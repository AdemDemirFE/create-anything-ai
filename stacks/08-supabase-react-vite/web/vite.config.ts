import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Stack 08 talks directly to Supabase, so unlike stacks 20/35 there is no
// same-origin API to proxy. The VITE_SUPABASE_URL is read by the client at
// runtime from the environment (see .env.example).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
