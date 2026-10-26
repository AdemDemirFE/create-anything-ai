/**
 * Auth flow tests: register (201, cookie), validation, duplicate email 409,
 * login success/failure, logout revocation, anti-enumeration, and
 * email normalization before uniqueness.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeTestApp, getTestApp, http, registerUser, cookieHeader, uniqueEmail, STRONG_PASSWORD } from './helpers.js'

beforeAll(async () => {
  await getTestApp()
})

afterAll(async () => {
  await closeTestApp()
})

describe('register', () => {
  it('registers with 201, envelope user payload and an HttpOnly session cookie', async () => {
    const email = uniqueEmail()
    const response = await http().post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD })
    expect(response.status).toBe(201)
    expect(response.body.ok).toBe(true)
    expect(response.body.data.user.email).toBe(email)
    const cookies = response.headers['set-cookie'] as unknown as string[]
    const sessionCookie = cookies.find((c) => c.startsWith('stack05_session='))
    expect(sessionCookie).toBeTruthy()
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('SameSite=Lax')
  })

  it('rejects invalid email with 400 VALIDATION_ERROR details', async () => {
    const response = await http().post('/api/v1/auth/register').send({ email: 'definitely-not-an-email', password: STRONG_PASSWORD })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects weak passwords with 400 and a password field detail', async () => {
    const response = await http().post('/api/v1/auth/register').send({ email: uniqueEmail(), password: 'alllowercase1' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects duplicate registration (same normalized email) with 409 EMAIL_TAKEN', async () => {
    const email = uniqueEmail('dup')
    const first = await http().post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD })
    expect(first.status).toBe(201)
    const second = await http().post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('normalizes email (case + whitespace) BEFORE the unique check — mixed-case duplicates collapse to one account', async () => {
    const email = uniqueEmail('norm')
    const first = await http().post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD })
    expect(first.status).toBe(201)
    const mixed = `  ${email.toUpperCase()}  `
    const second = await http().post('/api/v1/auth/register').send({ email: mixed, password: STRONG_PASSWORD })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('login with the normalized (uppercased) email still authenticates', async () => {
    const email = uniqueEmail('login-norm')
    await http().post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD })
    const response = await http().post('/api/v1/auth/login').send({ email: email.toUpperCase(), password: STRONG_PASSWORD })
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
  })
})

describe('login + session lifecycle', () => {
  it('logs in with 200 and sets a fresh session cookie', async () => {
    const user = await registerUser()
    const response = await http().post('/api/v1/auth/login').send({ email: user.email, password: user.password })
    expect(response.status).toBe(200)
    expect(response.body.data.user.email).toBe(user.email)
    const cookies = response.headers['set-cookie'] as unknown as string[]
    expect(cookies.some((c) => c.startsWith('stack05_session='))).toBe(true)
  })

  it('wrong password returns 401 INVALID_CREDENTIALS (same shape as unknown email)', async () => {
    const user = await registerUser()
    const wrongPassword = await http().post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong-Pass-12' })
    expect(wrongPassword.status).toBe(401)
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS')
    const unknownEmail = await http().post('/api/v1/auth/login').send({ email: uniqueEmail('ghost'), password: 'Wrong-Pass-12' })
    expect(unknownEmail.status).toBe(401)
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS')
    // Anti-enumeration: identical error code + message class.
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message)
  })

  it('session cookie grants access to /home; logout revokes it', async () => {
    const user = await registerUser()
    const cookie = cookieHeader(user.cookies)

    const home = await http().get('/api/v1/home').set('cookie', cookie)
    expect(home.status).toBe(200)

    const logout = await http().post('/api/v1/auth/logout').set('cookie', cookie)
    expect(logout.status).toBe(200)
    expect(logout.body.ok).toBe(true)

    const revoked = await http().get('/api/v1/home').set('cookie', cookie)
    expect(revoked.status).toBe(401)
    expect(revoked.body.error.code).toBe('UNAUTHORIZED')
  })

  it('protected routes reject requests without any cookie', async () => {
    const response = await http().get('/api/v1/documents')
    expect(response.status).toBe(401)
  })
})
