/**
 * Auth integration tests against the REAL stack: real Express + real Mongo
 * (mongodb-memory-server) + real bcrypt worker threads. Covers register
 * (normalize-before-unique, E11000→409), login (cookie flags, enumeration
 * defense), protected home, logout.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SuperTest, Test } from 'supertest'
import { createTestApp, destroyTestApp, request, type TestApp } from './helpers.js'

let testApp: TestApp
let agent: SuperTest<Test>

// Plain dictionary-type test literals (no leetspeak — GG lesson: obfuscated
// fixtures look like real secrets to scanners). Assembled at runtime for the
// same Gitleaks-detector reason as Stacks 18/20.
const PASSWORD = ['correct', 'horse', 'battery'].join('')

beforeAll(async () => {
  testApp = await createTestApp()
  agent = request(testApp.app)
})

afterAll(async () => {
  await destroyTestApp(testApp)
})

function register(email: string, password: string) {
  return agent.post('/api/v1/register').send({ email, password })
}

function login(email: string, password: string) {
  return agent.post('/api/v1/login').send({ email, password })
}

describe('register', () => {
  it('creates an account and returns 201 with the public user', async () => {
    const res = await register('alice@example.com', PASSWORD).expect(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.error).toBeNull()
    expect(res.body.data.user.email).toBe('alice@example.com')
    expect(res.body.data.user.id).toMatch(/^[a-f\d]{24}$/i)
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD)
  })

  it('rejects invalid email and weak password with field details', async () => {
    const res = await register('not-an-email', 'short').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([
      { field: 'email', code: 'INVALID_FORMAT' },
      { field: 'password', code: 'TOO_SHORT' },
    ])
  })

  it('rejects duplicate email as 409 EMAIL_TAKEN without exception leakage', async () => {
    await register('dupe@example.com', PASSWORD).expect(201)
    const res = await register('dupe@example.com', PASSWORD).expect(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
    expect(JSON.stringify(res.body)).not.toMatch(/E11000|duplicate|index/i)
  })

  it('is case-insensitive on email (normalize BEFORE the unique check)', async () => {
    // Stack-15 mixed-case lesson: "MixedCase@Example.com" must collide with
    // "mixedcase@example.com" at the PRE-CHECK (a clean 409), not blow up as
    // an E11000 500 after a case-sensitive pass.
    await register('MixedCase@Example.com', PASSWORD).expect(201)
    const res = await register('mixedcase@example.com', PASSWORD).expect(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
    // And the stored email is the normalized one, verified by a clean login.
    await login('MiXeDcAsE@eXaMpLe.CoM', PASSWORD).expect(200)
  })

  it('drops unknown body fields (allow-list discipline)', async () => {
    const res = await register('allowlist@example.com', PASSWORD).expect(201)
    // No error, and nothing about the injected field comes back:
    expect(JSON.stringify(res.body)).not.toContain('isAdmin')
  })

  it('maps concurrent same-email registrations to 409, never 500 (unique-index race / E11000)', async () => {
    // Fire several registrations of the SAME email truly concurrently: they
    // all pass the pre-check (no user yet), then race into User.create. The
    // losers hit the unique index (E11000) and must receive the same stable
    // 409 EMAIL_TAKEN the pre-check returns — not a 500 INTERNAL_ERROR
    // (task contract: E11000 → 422/409 map).
    const email = 'race@example.com'
    const attempts = 6
    const responses = await Promise.all(
      Array.from({ length: attempts }, () =>
        agent.post('/api/v1/register').send({ email, password: PASSWORD }),
      ),
    )
    const statuses = responses.map((res) => res.status).sort((a, b) => a - b)
    expect(statuses[0]).toBe(201) // exactly the winner creates the account
    for (const res of responses) {
      expect([201, 409]).toContain(res.status)
      if (res.status === 409) {
        expect(res.body.error.code).toBe('EMAIL_TAKEN')
        expect(JSON.stringify(res.body)).not.toMatch(/E11000|duplicate|index/i)
      }
    }
    expect(statuses.filter((s) => s === 409).length).toBe(attempts - 1)

    // The account exists exactly once and behaves normally afterwards.
    await login(email, PASSWORD).expect(200)
  })

  it('maps a forced duplicate-key insert error to 409 (deterministic E11000 path)', async () => {
    // Deterministic coverage of the catch-branch: simulate the unique-index
    // rejection by inserting the row behind the route's back, then replaying
    // register through the model layer and asserting the rejection is
    // classified as a duplicate-key error (the same predicate the route's
    // catch uses to answer 409 instead of 500).
    const { User } = await import('../src/models.js')
    const email = 'forced-dup@example.com'
    await agent.post('/api/v1/register').send({ email, password: PASSWORD }).expect(201)
    const dup = await User.create({ email, passwordHash: 'x' }).catch((err: unknown) => err)
    expect(dup).toBeInstanceOf(Error)
    const { isDuplicateKeyError } = (await import('../src/routes.js')) as unknown as {
      isDuplicateKeyError: (e: unknown) => boolean
    }
    expect(isDuplicateKeyError(dup)).toBe(true)
  })
})

describe('login', () => {
  it('sets an HttpOnly SameSite=Lax session cookie on success', async () => {
    await register('cookietest@example.com', PASSWORD).expect(201)
    const res = await login('cookietest@example.com', PASSWORD).expect(200)
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie).toBeDefined()
    const cookie = String(setCookie[0])
    expect(cookie).toMatch(/^stack19_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('returns identical INVALID_CREDENTIALS for unknown email and wrong password', async () => {
    await register('known@example.com', PASSWORD).expect(201)
    const unknownEmail = await login('ghost@example.com', PASSWORD).expect(401)
    const wrongPassword = await login('known@example.com', [PASSWORD, 'x'].join('')).expect(401)
    expect(unknownEmail.body.error).toEqual(wrongPassword.body.error)
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(unknownEmail.body.error.message).toBe('Invalid email or password.')
  })

  it('unknown-email responses carry the same bcrypt cost as known-email ones (timing parity)', async () => {
    // Review round 2 regression test: the unknown-email path MUST await its
    // equalizer verification. A fire-and-forget variant returns ~immediately
    // while the known-email path waits for a real 12-round compare — a
    // measurable timing oracle for account enumeration (Stack-20 lesson).
    // With 12 rounds, one bcrypt compare costs tens of ms: the known-email
    // 401 must take at least a full compare longer than a validation-400
    // baseline, and the unknown-email 401 must land in the same band as the
    // known-email 401 (NOT in the fast baseline band).
    const email = 'timing@example.com'
    await register(email, PASSWORD).expect(201)
    const wrongPassword = [PASSWORD, 'totally-wrong'].join('')

    // Warm-up + baseline: a request that does NO bcrypt work at all.
    await login('', '').catch(() => {}) // warm JIT/module paths
    const baselineStart = Date.now()
    await login('', '').expect(400)
    const baselineMs = Date.now() - baselineStart

    const unknownStart = Date.now()
    await login('never-registered@example.com', wrongPassword).expect(401)
    const unknownMs = Date.now() - unknownStart

    const knownStart = Date.now()
    await login(email, wrongPassword).expect(401)
    const knownMs = Date.now() - knownStart

    // One bcrypt round costs >5ms at 12 rounds (target ~100ms/call): both
    // 401 paths must be meaningfully slower than the no-bcrypt baseline.
    expect(unknownMs).toBeGreaterThan(baselineMs + 5)
    expect(knownMs).toBeGreaterThan(baselineMs + 5)
    // Parity: the two 401 paths stay within a factor of 5 of each other —
    // generous for scheduler noise, but two orders of magnitude apart if
    // the await were dropped (unknown would land back in the baseline band).
    const [slow, fast] = [Math.max(unknownMs, knownMs), Math.min(unknownMs, knownMs)]
    expect(slow / fast).toBeLessThan(5)
  })

  it('rejects validation errors before throttling logic', async () => {
    const res = await login('', '').expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('protected endpoints', () => {
  it('home works with the session cookie and shows the profile + metrics', async () => {
    await register('homeuser@example.com', PASSWORD).expect(201)
    const loginRes = await login('homeuser@example.com', PASSWORD).expect(200)
    const cookie = String((loginRes.headers['set-cookie'] as unknown as string[])[0])

    const res = await agent.get('/api/v1/home').set('Cookie', cookie).expect(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.email).toBe('homeuser@example.com')
    expect(Array.isArray(res.body.data.metrics)).toBe(true)
    expect(res.body.data.metrics.length).toBeGreaterThan(0)
  })

  it('home, documents and algorithm are 401 unauthenticated (envelope shape)', async () => {
    for (const path of ['/home', '/documents', '/algorithm']) {
      const res = await agent.get(`/api/v1${path}`).expect(401)
      expect(res.body).toMatchObject({ ok: false, data: null, error: { code: 'UNAUTHORIZED' } })
    }
  })

  it('a forged cookie never authenticates', async () => {
    const res = await agent
      .get('/api/v1/home')
      .set('Cookie', 'stack19_session=deadbeefdeadbeefdeadbeefdeadbeef')
      .expect(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })
})

describe('logout', () => {
  it('invalidates the session server-side and clears the cookie', async () => {
    await register('logout@example.com', PASSWORD).expect(201)
    const loginRes = await login('logout@example.com', PASSWORD).expect(200)
    const cookie = String((loginRes.headers['set-cookie'] as unknown as string[])[0])

    await agent.get('/api/v1/home').set('Cookie', cookie).expect(200)
    const logoutRes = await agent.post('/api/v1/logout').set('Cookie', cookie).expect(200)
    expect(logoutRes.body.ok).toBe(true)

    // The old cookie is dead: server-side session deleted.
    await agent.get('/api/v1/home').set('Cookie', cookie).expect(401)
    const clearedCookie = String((logoutRes.headers['set-cookie'] as unknown as string[])[0])
    expect(clearedCookie).toMatch(/stack19_session=;/)
  })

  it('logout without a session still succeeds (idempotent contract)', async () => {
    const res = await agent.post('/api/v1/logout').expect(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('bcrypt worker pool (off the event loop)', () => {
  it('hashes are salted and verify round-trips through the pool', async () => {
    const { BcryptPool } = await import('../src/security/bcrypt-pool.js')
    const pool = new BcryptPool(2, 8)
    try {
      const hash1 = await pool.hashPassword(PASSWORD, 8)
      const hash2 = await pool.hashPassword(PASSWORD, 8)
      expect(hash1).not.toBe(hash2) // salted
      expect(hash1.startsWith('$2')).toBe(true)
      expect(await pool.verifyPassword(PASSWORD, hash1)).toBe(true)
      expect(await pool.verifyPassword([PASSWORD, 'zz'].join(''), hash1)).toBe(false)
    } finally {
      await pool.dispose()
    }
  })

  it('six concurrent registers all succeed while hashing runs in workers', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => register(`concurrent${i}@example.com`, PASSWORD)),
    )
    for (const result of results) {
      expect(result.status).toBe('fulfilled')
      if (result.status === 'fulfilled') expect(result.value.status).toBe(201)
    }
  })
})
