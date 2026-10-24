/**
 * Supabase browser client (stack 08).
 *
 * In the BaaS model the browser holds the PUBLIC anon key and talks straight
 * to the hosted services; there is no backend of ours in between. The anon
 * key is not a secret — Row Level Security (see supabase/migrations) is the
 * authorization boundary. The service_role key must never appear in this
 * bundle.
 *
 * Config is read from Vite env vars (see .env.example). The client throws at
 * construction time when configuration is missing: a missing anon key must
 * fail loudly during setup, not at the first click (Gate D: "a missing
 * required secret causes safe startup failure with a clear message").
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export function readSupabaseEnv(env: {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}): { url: string; anonKey: string } {
  const url = env.VITE_SUPABASE_URL?.trim()
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url) {
    throw new Error(
      'Missing VITE_SUPABASE_URL. Copy web/.env.example to web/.env and set your project URL.',
    )
  }
  if (!anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_ANON_KEY. Copy web/.env.example to web/.env and set the public anon key.',
    )
  }
  return { url, anonKey }
}

let cachedClient: SupabaseClient<Database> | null = null

export function getSupabaseClient(): SupabaseClient<Database> {
  if (cachedClient) return cachedClient
  const { url, anonKey } = readSupabaseEnv(import.meta.env)
  cachedClient = createClient<Database>(url, anonKey, {
    auth: {
      // The SPA never consumes OAuth/magic-link callbacks in the reference
      // flow; disabling URL detection keeps `getSession()` free of surprises.
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return cachedClient
}

/** Test seam: drop the cached instance (used by tests to swap the client). */
export function resetSupabaseClient(): void {
  cachedClient = null
}
