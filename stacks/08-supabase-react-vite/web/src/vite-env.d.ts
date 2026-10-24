/// <reference types="vite/client" />

// Augment Vite's ImportMetaEnv with this stack's env vars (canonical Vite
// pattern). Augmenting (instead of casting `import.meta.env` at call sites)
// keeps every reader typed and lets tsc catch a renamed variable.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
