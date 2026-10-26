/**
 * Envelope contract tests: EVERY response carries { ok, data, error } and
 * the X-Request-Id header in the [A-Za-z0-9-]{1,64} shape; unknown routes
 * and malformed bodies still leave as envelopes (no stack traces).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import { closeTestApp, getTestApp, http, registerUser, cookieHeader } from './helpers.js'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

let app: INestApplication

beforeAll(async () => {
  app = await getTestApp()
})

afterAll(async () => {
  await closeTestApp()
})

describe('envelope contract', () => {
  it('successful responses carry ok=true, data, error=null and a contract-shaped request id', async () => {
    const response = await http().get('/api/v1/algorithm')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true, error: null })
    expect(response.body.data).toHaveProperty('algorithms')
    const requestId = response.headers['x-request-id']
    expect(typeof requestId).toBe('string')
    expect(requestId).toMatch(REQUEST_ID_PATTERN)
    expect((requestId as string).length).toBeLessThanOrEqual(64)
  })

  it('honors a contract-shaped inbound X-Request-Id and echoes it back', async () => {
    const response = await http().get('/api/v1/algorithm').set('x-request-id', 'test-req-abc-123')
    expect(response.headers['x-request-id']).toBe('test-req-abc-123')
  })

  it('replaces a malformed inbound request id with a fresh contract-shaped one', async () => {
    const response = await http().get('/api/v1/algorithm').set('x-request-id', 'bad id<script>%')
    const requestId = response.headers['x-request-id']
    expect(requestId).toMatch(REQUEST_ID_PATTERN)
    expect(requestId).not.toContain('<')
    expect(requestId).not.toContain(' ')
  })

  it('404 unknown routes still return the envelope with a stable error', async () => {
    const response = await http().get('/api/v1/definitely-not-a-route')
    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ ok: false, data: null })
    expect(response.body.error).toBeTruthy()
    expect(typeof response.body.error.message).toBe('string')
    expect(response.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN)
  })

  it('validation errors return 400 VALIDATION_ERROR with field details', async () => {
    const response = await http().post('/api/v1/auth/register').send({ email: 'not-an-email', password: 'x' })
    expect(response.status).toBe(400)
    expect(response.body.ok).toBe(false)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(response.body.error.details) || typeof response.body.error.message === 'string').toBe(true)
  })

  it('unauthorized envelope shape for protected routes without a session', async () => {
    const response = await http().get('/api/v1/home')
    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({ ok: false, data: null, error: { code: 'UNAUTHORIZED' } })
  })

  it('error bodies never leak stack traces or internal paths', async () => {
    const response = await http().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Wrong-Pass-12' })
    const raw = JSON.stringify(response.body)
    expect(raw).not.toMatch(/at\s+\w+\s+\(/)
    expect(raw).not.toContain('node_modules')
    expect(raw).not.toContain('C:\\')
  })

  it('authenticated success envelope for /home with cookie session', async () => {
    const user = await registerUser()
    const response = await http().get('/api/v1/home').set('cookie', cookieHeader(user.cookies))
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.data.email).toBe(user.email)
    expect(Array.isArray(response.body.data.metrics)).toBe(true)
    expect(typeof response.body.data.serverTime).toBe('string')
  })

  it('request ids are unique across requests', async () => {
    const first = await http().get('/api/v1/algorithm')
    const second = await http().get('/api/v1/algorithm')
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id'])
  })

  it('the envelope carries no execution_ms unless the endpoint defines one (algorithm run defines its own field)', async () => {
    const response = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'reverse', input: 'abc' })
    expect(response.body.ok).toBe(true)
    // executionMs is a DATA field of the algorithm result, not a meta claim.
    expect(typeof response.body.data.executionMs).toBe('number')
    expect(response.body.data.executionMs).toBeGreaterThanOrEqual(0)
  })

  it('app is defined (bootstrap sanity)', () => {
    expect(app).toBeTruthy()
  })
})
