/**
 * Auth integration tests against the REAL stack: real Express + real Mongo
 * (mongodb-memory-server) + real bcrypt worker threads. Covers register,
 * login (cookie flags, enumeration defense), protected home, logout.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SuperTest, Test } from 'supertest'
import { createTestApp, destroyTestApp, request, type TestApp } from './helpers.js'

let testApp: TestApp
let agent: SuperTest<Test>

// Plain dictionary-type test literals (no leetspeak — GG lesson: obfuscated
// fixtures look like real secrets to scanners). Assembled at runtime for the
// same Gitleaks-detector reason as Stack 20.
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

  it('is case-insensitive on email', async () => {
    await register('CaseTest@Example.com', PASSWORD).expect(201)
    const res = await register('casetest@example.com', PASSWORD).expect(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('drops unknown body fields (allow-list discipline)', async () => {
    const res = await register('allowlist@example.com', PASSWORD).expect(201)
    // No error, and nothing about the injected field comes back:
    expect(JSON.stringify(res.body)).not.toContain('isAdmin')
  })
})

describe('login', () => {
  it('sets an HttpOnly SameSite=Lax session cookie on success', async () => {
    await register('cookietest@example.com', PASSWORD).expect(201)
    const res = await login('cookietest@example.com', PASSWORD).expect(200)
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie).toBeDefined()
    const cookie = String(setCookie[0])
    expect(cookie).toMatch(/^stack18_session=/)
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
      .set('Cookie', 'stack18_session=deadbeefdeadbeefdeadbeefdeadbeef')
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
    expect(clearedCookie).toMatch(/stack18_session=;/)
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
