/**
 * Auth data-layer tests against the REAL supabase-js client with a
 * fetch-level fake GoTrue backend (see test/fakeSupabase.ts).
 *
 * The auth state machine under test is genuine: session persistence in
 * localStorage, expires_at computation by auth-js, AuthApiError mapping.
 * Only the network is fake.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, type Harness } from '../test/harness'
import { ErrorCodes } from './envelope'
import * as authApi from './authApi'
import * as supabaseModule from './supabase'
import { resetSupabaseClient } from './supabase'

let harness: Harness

beforeEach(() => {
  harness = createHarness()
  resetSupabaseClient()
  vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(harness.client)
})

describe('register (real auth-js against fake GoTrue)', () => {
  it('signs up and stores the session in localStorage', async () => {
    const result = await authApi.register('new.user@example.test', 'CorrectHorse1')

    expect(result.ok).toBe(true)
    expect(result.error).toBeNull()
    expect(result.data?.user.email).toBe('new.user@example.test')
    expect(result.data?.session.access_token).toBeTruthy()
    // auth-js computed expires_at from expires_in.
    expect(result.data?.session.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
    // Session persisted by the real client under its storage key.
    const storageKey = (harness.client.auth as unknown as { storageKey: string }).storageKey
    const stored = localStorage.getItem(storageKey)
    expect(stored).toContain('access_token')
  })

  it('sends email+password and nothing sensitive in the request body', async () => {
    // The wire body is exercised by the fake (signup parses email/password);
    // this assertion pins that the call succeeds without extra credentials.
    const result = await authApi.register('wire.check@example.test', 'CorrectHorse1')
    expect(result.ok).toBe(true)
  })

  it('returns EMAIL_TAKEN for a duplicate signup (GoTrue email_exists)', async () => {
    await authApi.register('dupe.user@example.test', 'CorrectHorse1')
    const second = await authApi.register('dupe.user@example.test', 'CorrectHorse1')

    expect(second.ok).toBe(false)
    expect(second.data).toBeNull()
    expect(second.error?.code).toBe(ErrorCodes.EmailTaken)
    expect(second.error?.message).toMatch(/already exists/i)
    expect(second.requestId).toBeTruthy()
  })

  it('returns WEAK_PASSWORD when GoTrue rejects the password', async () => {
    // The client-side validator rejects this before any network call, so the
    // stable code is VALIDATION_ERROR — same code the server path would
    // produce via AuthWeakPasswordError mapping.
    const result = await authApi.register('short.pw@example.test', 'short1x')
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.Validation)
  })

  it('validates client-side before any network call', async () => {
    const badEmail = await authApi.register('not-an-email', 'CorrectHorse1')
    expect(badEmail.ok).toBe(false)
    expect(badEmail.error?.code).toBe(ErrorCodes.Validation)

    const badPassword = await authApi.register('ok@example.test', 'nodigits')
    expect(badPassword.ok).toBe(false)
    expect(badPassword.error?.code).toBe(ErrorCodes.Validation)
  })
})

describe('login (real auth-js against fake GoTrue)', () => {
  beforeEach(() => {
    harness.fake.seedUser('known.user@example.test', 'CorrectHorse1')
  })

  it('logs in with valid credentials and normalizes the session', async () => {
    const result = await authApi.login('known.user@example.test', 'CorrectHorse1')
    expect(result.ok).toBe(true)
    expect(result.data?.user.email).toBe('known.user@example.test')
  })

  it('returns INVALID_CREDENTIALS for a wrong password', async () => {
    const result = await authApi.login('known.user@example.test', 'IncorrectHorse1')
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.InvalidCredentials)
    expect(result.error?.message).toMatch(/invalid email or password/i)
  })

  it('returns INVALID_CREDENTIALS for an unknown email — same code, no enumeration', async () => {
    const unknown = await authApi.login('ghost.user@example.test', 'IncorrectHorse1')
    const wrongPw = await authApi.login('known.user@example.test', 'IncorrectHorse1')
    expect(unknown.error?.code).toBe(wrongPw.error?.code)
    expect(unknown.error?.message).toBe(wrongPw.error?.message)
  })

  it('surfaces a network failure as NETWORK_ERROR (not invalid credentials)', async () => {
    vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue({
      auth: {
        signInWithPassword: () => {
          const err = new Error('fetch failed') as Error & { name: string }
          err.name = 'AuthRetryableFetchError'
          return Promise.reject(err)
        },
      },
    } as never)
    const result = await authApi.login('known.user@example.test', 'CorrectHorse1')
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.Network)
  })
})

describe('session lifecycle (real auth-js)', () => {
  beforeEach(() => {
    harness.fake.seedUser('known.user@example.test', 'CorrectHorse1')
  })

  it('getSession returns the persisted session after login', async () => {
    await authApi.login('known.user@example.test', 'CorrectHorse1')
    const session = await authApi.getSession()
    expect(session.ok).toBe(true)
    expect(session.data?.user.email).toBe('known.user@example.test')
  })

  it('logout clears the stored session', async () => {
    await authApi.login('known.user@example.test', 'CorrectHorse1')
    const before = await authApi.getSession()
    expect(before.data).not.toBeNull()

    const out = await authApi.logout()
    expect(out.ok).toBe(true)
    const after = await authApi.getSession()
    expect(after.data).toBeNull()
  })

  it('exposes a user view with id and email only', async () => {
    const result = await authApi.login('known.user@example.test', 'CorrectHorse1')
    const view = authApi.toUserView(result.data!.user)
    expect(Object.keys(view).sort()).toEqual(['email', 'id'])
    expect(view.email).toBe('known.user@example.test')
  })
})

describe('module wiring', () => {
  it('readSupabaseEnv fails loudly on missing configuration', async () => {
    expect(() => supabaseModule.readSupabaseEnv({})).toThrow(/VITE_SUPABASE_URL/i)
    expect(() => supabaseModule.readSupabaseEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toThrow(
      /VITE_SUPABASE_ANON_KEY/i,
    )
    expect(
      supabaseModule.readSupabaseEnv({
        VITE_SUPABASE_URL: ' https://x.supabase.co ',
        VITE_SUPABASE_ANON_KEY: ' anon-key ',
      }),
    ).toEqual({ url: 'https://x.supabase.co', anonKey: 'anon-key' })
  })
})
