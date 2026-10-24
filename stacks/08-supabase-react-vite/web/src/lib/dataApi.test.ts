/**
 * Apps data-layer tests: the REAL supabase-js PostgREST client against the
 * fetch-level fake. RLS row-visibility semantics (owner-only) are enforced
 * by the fake exactly as the SQL policies specify, and these tests pin the
 * client-side behavior for each denial/error path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness, type Harness } from '../test/harness'
import * as dataApi from './dataApi'
import * as supabaseModule from './supabase'
import { resetSupabaseClient } from './supabase'
import { ErrorCodes } from './envelope'

let harness: Harness
let ownerId: string
let otherId: string

beforeEach(async () => {
  harness = createHarness()
  resetSupabaseClient()
  vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue(harness.client)

  const owner = harness.fake.seedUser('owner@example.test', 'CorrectHorse1')
  const other = harness.fake.seedUser('other@example.test', 'CorrectHorse1')
  ownerId = owner.id
  otherId = other.id

  // Sign the real client in as owner so its JWT identifies the subject.
  const login = await harness.client.auth.signInWithPassword({
    email: 'owner@example.test',
    password: 'CorrectHorse1',
  })
  expect(login.error).toBeNull()
})

describe('listApps (RLS select policy)', () => {
  it('returns only the signed-in owner rows, newest first', async () => {
    harness.fake.seedApp(ownerId, 'Alpha')
    harness.fake.seedApp(ownerId, 'Beta')
    harness.fake.seedApp(otherId, 'NotMine')

    const result = await dataApi.listApps()
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(2)
    expect(result.data?.map((r) => r.name)).toEqual(['Beta', 'Alpha']) // created_at desc
    expect(result.data?.every((r) => r.user_id === ownerId)).toBe(true)
  })

  it('returns an empty list (not an error) when the user owns nothing', async () => {
    const result = await dataApi.listApps()
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })
})

describe('getApp (RLS + maybeSingle semantics)', () => {
  it('returns the row for the owner', async () => {
    const row = harness.fake.seedApp(ownerId, 'Mine')
    const result = await dataApi.getApp(row.id)
    if (!result.ok) {
      throw new Error('getApp failed: ' + JSON.stringify(result.error))
    }
    expect(result.data?.name).toBe('Mine')
  })

  it('returns NOT_FOUND for another user\'s app (RLS hides the row)', async () => {
    const foreign = harness.fake.seedApp(otherId, 'Theirs')
    const result = await dataApi.getApp(foreign.id)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.NotFound)
    expect(result.error?.message).not.toContain(foreign.id)
  })

  it('validates a missing id before touching the network', async () => {
    const result = await dataApi.getApp('')
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.Validation)
  })
})

describe('createApp (RLS insert policy WITH CHECK)', () => {
  it('creates a row owned by the JWT subject — user_id never sent', async () => {
    const result = await dataApi.createApp({ name: '  New App  ', description: ' desc ' })
    expect(result.ok).toBe(true)
    expect(result.data?.name).toBe('New App')
    expect(result.data?.description).toBe('desc')
    expect(result.data?.user_id).toBe(ownerId)
    expect(result.data?.status).toBe('draft')
  })

  it('rejects invalid input client-side without a network call', async () => {
    const empty = await dataApi.createApp({ name: '   ' })
    expect(empty.ok).toBe(false)
    expect(empty.error?.code).toBe(ErrorCodes.Validation)

    const tooLong = await dataApi.createApp({ name: 'x'.repeat(81) })
    expect(tooLong.ok).toBe(false)
    expect(tooLong.error?.code).toBe(ErrorCodes.Validation)
    expect(tooLong.error?.message).toMatch(/at most 80/i)
  })

  it('maps the unique constraint (23505) to CONFLICT for duplicate names', async () => {
    harness.fake.seedApp(ownerId, 'Duplicate')
    const result = await dataApi.createApp({ name: 'Duplicate' })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.Conflict)
  })

  it('maps an anonymous insert (no JWT) to FORBIDDEN with the 42501 semantics', async () => {
    // Sign the real client out: requests now carry no user token.
    await harness.client.auth.signOut()
    const result = await dataApi.createApp({ name: 'Should Fail' })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.Forbidden)
    expect(result.error?.status).toBe(403)
  })
})

describe('updateApp (RLS update policy)', () => {
  it('updates an owned row and returns it', async () => {
    const row = harness.fake.seedApp(ownerId, 'Before')
    const result = await dataApi.updateApp(row.id, { name: 'After', status: 'active' })
    if (!result.ok) {
      throw new Error('update failed: ' + JSON.stringify(result.error))
    }
    expect(result.data?.name).toBe('After')
    expect(result.data?.status).toBe('active')
    expect(result.data && row ? result.data.updated_at >= row.updated_at : false).toBe(true)
  })

  it('returns NOT_FOUND when updating another user\'s app', async () => {
    const foreign = harness.fake.seedApp(otherId, 'Theirs')
    const result = await dataApi.updateApp(foreign.id, { name: 'Hijack' })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.NotFound)
    // The fake never applied the write (RLS would reject it server-side).
    expect(harness.fake.apps.find((r) => r.id === foreign.id)?.name).toBe('Theirs')
  })

  it('maps duplicate-name conflicts to CONFLICT', async () => {
    harness.fake.seedApp(ownerId, 'Existing')
    const row = harness.fake.seedApp(ownerId, 'Renamable')
    const result = await dataApi.updateApp(row.id, { name: 'Existing' })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.Conflict)
  })
})

describe('deleteApp (RLS delete policy)', () => {
  it('deletes an owned row', async () => {
    const row = harness.fake.seedApp(ownerId, 'Doomed')
    const result = await dataApi.deleteApp(row.id)
    expect(result.ok).toBe(true)
    expect(harness.fake.apps.some((r) => r.id === row.id)).toBe(false)
  })

  it('succeeds as a no-op for a foreign id (PostgREST 204 on zero rows)', async () => {
    const foreign = harness.fake.seedApp(otherId, 'Untouchable')
    const result = await dataApi.deleteApp(foreign.id)
    expect(result.ok).toBe(true)
    // The row is still there: RLS prevented the delete.
    expect(harness.fake.apps.some((r) => r.id === foreign.id)).toBe(true)
  })
})

describe('transport failure normalization', () => {
  it('maps a thrown fetch to NETWORK_ERROR', async () => {
    vi.spyOn(supabaseModule, 'getSupabaseClient').mockReturnValue({
      from: () => {
        throw new Error('fetch failed')
      },
    } as never)
    const result = await dataApi.listApps()
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe(ErrorCodes.Network)
  })
})
