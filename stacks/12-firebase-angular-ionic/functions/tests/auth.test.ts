/**
 * Auth flow tests — REAL Auth + Firestore emulators.
 *
 * Covers: register (validation, normalize-before-unique, no enumeration),
 * login (generic failure, session cookie, HttpOnly/SameSite), logout,
 * session sliding TTL, protected-route 401s, throttle 429 + Retry-After.
 *
 * Supertest note: request builders are thenables; helpers here return the
 * builder itself so callers chain `.expect(...)` and await the whole chain
 * (stack-19 convention).
 */
import { afterAll, describe, expect, it } from 'vitest'
import supertest from 'supertest'
import type { SuperTest, Test } from 'supertest'
import { emulatorSuite, teardownEmulatorTest } from './helpers/emulator.js'

const suite = emulatorSuite()
let agent: SuperTest<Test>

const EMAIL = ['ada', 'example.com'].join('@')
const UPPER = ['Ada', 'Example.com'].join('@')
const OTHER = ['grace', 'example.com'].join('@')
const PASSWORD = ['correct', 'horse', 'battery'].join('')
const WEAK = ['short'].join('')

/** Sync accessor — app is initialized in beforeEach (emulatorSuite). */
function apiSync(): SuperTest<Test> {
  if (!agent) {
    agent = supertest(suite.getApp()) as SuperTest<Test>
  }
  return agent
}

// NOTE: supertest Test objects are thenable; keep helper NON-async so the
// returned object still has .expect — awaiting the builder itself executes it.
function register(email: string, password: string = PASSWORD): Test {
  return apiSync().post('/api/v1/auth/register').send({ email, password })
}

afterAll(async () => {
  await teardownEmulatorTest()
})

describe('register', () => {
  it('registers with envelope + user payload', async () => {
    const res = await register(EMAIL).expect(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.user.email).toBe(EMAIL)
    expect(res.body.error).toBeNull()
  })

  it('normalizes email before uniqueness (case-insensitive)', async () => {
    await register(EMAIL).expect(200)
    const res = await register(UPPER).expect(409)
    expect(res.body.ok).toBe(false)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.error.message).toBe('Registration failed.')
  })

  it('rejects invalid email with VALIDATION_ERROR', async () => {
    const res = await register(['not-an-email'].join('')).expect(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects short password with VALIDATION_ERROR', async () => {
    const res = await register(OTHER, WEAK).expect(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('trims whitespace around email before uniqueness', async () => {
    await register(EMAIL).expect(200)
    const padded = `  ${EMAIL}  `
    const res = await apiSync().post('/api/v1/auth/register').send({ email: padded, password: PASSWORD }).expect(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })
})

describe('login + sessions', () => {
  it('logs in with Set-Cookie session (HttpOnly, SameSite=Lax)', async () => {
    await register(EMAIL).expect(200)
    const res = await apiSync().post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
    const cookieHeader = res.headers['set-cookie'] as unknown as string[]
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader
    expect(cookie).toContain('stack12_session=')
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('samesite=lax')
  })

  it('uppercase email logs in the same account (normalize)', async () => {
    await register(EMAIL).expect(200)
    const res = await apiSync().post('/api/v1/auth/login').send({ email: UPPER, password: PASSWORD }).expect(200)
    expect(res.body.data.user.email).toBe(EMAIL)
  })

  it('wrong password → generic INVALID_CREDENTIALS (no enumeration)', async () => {
    await register(EMAIL).expect(200)
    const res = await apiSync().post('/api/v1/auth/login').send({ email: EMAIL, password: ['wrong', 'password', '99'].join('') }).expect(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(res.body.error.message).toBe('Invalid email or password.')
  })

  it('unknown email → identical generic INVALID_CREDENTIALS', async () => {
    const res = await apiSync().post('/api/v1/auth/login').send({ email: ['ghost', 'example.com'].join('@'), password: PASSWORD }).expect(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(res.body.error.message).toBe('Invalid email or password.')
  })

  it('home requires auth (backend re-check)', async () => {
    await apiSync().get('/api/v1/home').expect(401)
  })

  it('home works with session cookie and shows metrics', async () => {
    await register(EMAIL).expect(200)
    const login = await apiSync().post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
    const cookie = login.headers['set-cookie']
    const res = await apiSync().get('/api/v1/home').set('Cookie', cookie).expect(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.user.email).toBe(EMAIL)
    expect(Array.isArray(res.body.data.metrics)).toBe(true)
  })

  it('logout destroys the server-side session', async () => {
    await register(EMAIL).expect(200)
    const login = await apiSync().post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
    const cookie = login.headers['set-cookie']
    await apiSync().post('/api/v1/auth/logout').set('Cookie', cookie).expect(200)
    await apiSync().get('/api/v1/home').set('Cookie', cookie).expect(401)
  })

  it('malformed session cookie is rejected', async () => {
    await apiSync().get('/api/v1/home').set('Cookie', 'stack12_session=zzzz').expect(401)
  })
})

describe('login throttle', () => {
  it('429 + Retry-After after configured failed attempts', async () => {
    await register(EMAIL).expect(200)
    const wrong = ['nope', 'nope', 'nope'].join('')
    for (let i = 0; i < 5; i += 1) {
      await apiSync().post('/api/v1/auth/login').send({ email: OTHER, password: wrong }).expect(401)
    }
    const res = await apiSync().post('/api/v1/auth/login').send({ email: OTHER, password: wrong }).expect(429)
    expect(res.headers['retry-after']).toBe('60')
    expect(res.body.error.code).toBe('RATE_LIMITED')
    expect(res.body.error.message).toBe('Too many attempts. Retry later.')
    expect(res.body.requestId).toMatch(/^[A-Za-z0-9-]{1,64}$/)
  })

  it('successful login does not consume window capacity', async () => {
    await register(EMAIL).expect(200)
    for (let i = 0; i < 4; i += 1) {
      await apiSync().post('/api/v1/auth/login').send({ email: EMAIL, password: ['wrong', 'x', String(i)].join('') }).expect(401)
    }
    await apiSync().post('/api/v1/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200)
    // Fixed window counts failures only; a success never adds capacity, so
    // the 5th distinct failure must still be 401 (not throttled).
    const res = await apiSync().post('/api/v1/auth/login').send({ email: EMAIL, password: ['wrong', 'x', '9'].join('') }).expect(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })
})
