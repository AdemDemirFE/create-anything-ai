/**
 * Test helper: a real supabase-js client pointed at the fake backend.
 *
 * This is THE important test-harness decision of this stack: the client code
 * under test (authApi/dataApi/envelope) runs against the real
 * @supabase/supabase-js state machine — session persistence in localStorage,
 * expires_at computation, error mapping — with only the network replaced by
 * the fetch-level fake GoTrue/PostgREST implementation.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ANON_KEY, SUPABASE_URL, createFakeFetch, FakeSupabase } from './fakeSupabase'
import type { Database } from '../lib/database.types'

export interface Harness {
  fake: FakeSupabase
  client: SupabaseClient<Database>
}

export function createHarness(): Harness {
  const fake = new FakeSupabase()
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    global: { fetch: createFakeFetch(fake) },
    auth: {
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: false,
      // Isolate tests from each other despite the shared localStorage key.
      storageKey: `sb-stack08-test-${crypto.randomUUID()}-auth-token`,
    },
  })
  return { fake, client }
}
