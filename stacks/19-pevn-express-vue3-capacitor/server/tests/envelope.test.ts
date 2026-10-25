/**
 * Envelope contract tests: {ok, data, error, requestId} on every response,
 * plus the X-Request-Id validation lesson from Stack 20 — a client-supplied
 * id is honored only when it matches ^[A-Za-z0-9-]{1,64}$; anything else is
 * replaced by a fresh opaque id in BOTH the header and the body.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SuperTest, Test } from 'supertest'
import { createTestApp, destroyTestApp, request, type TestApp } from './helpers.js'

let testApp: TestApp
let agent: SuperTest<Test>

beforeAll(async () => {
  testApp = await createTestApp()
  agent = request(testApp.app)
})

afterAll(async () => {
  await destroyTestApp(testApp)
})

describe('envelope contract', () => {
  it('health is intentionally envelope-less (trivial probe)', async () => {
    const res = await agent.get('/api/v1/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('wraps 404 unknown routes in the envelope', async () => {
    const res = await agent.get('/api/v1/definitely-not-a-route').expect(404)
    expect(res.body).toMatchObject({
      ok: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    })
    expect(typeof res.body.requestId).toBe('string')
    expect(res.body.requestId).toMatch(/^[a-f0-9]{32}$/)
  })

  it('wraps malformed JSON bodies in a validation envelope', async () => {
    const res = await agent
      .post('/api/v1/login')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ ok: false, data: null, error: { code: 'VALIDATION_ERROR' } })
  })

  it('mirrors the requestId header and body on success responses', async () => {
    const res = await agent.post('/api/v1/register').send({}).expect(400)
    expect(res.headers['x-request-id']).toBe(res.body.requestId)
  })
})

describe('X-Request-Id validation (Stack-20 lesson)', () => {
  it('honors a valid client-supplied X-Request-Id (header + body)', async () => {
    const res = await agent
      .post('/api/v1/register')
      .set('X-Request-Id', 'my-correlation-ID-123')
      .send({})
      .expect(400)
    expect(res.headers['x-request-id']).toBe('my-correlation-ID-123')
    expect(res.body.requestId).toBe('my-correlation-ID-123')
  })

  it('honors a 64-character id at the pattern boundary', async () => {
    const maxId = 'A'.repeat(64)
    const res = await agent.post('/api/v1/register').set('X-Request-Id', maxId).send({}).expect(400)
    expect(res.headers['x-request-id']).toBe(maxId)
    expect(res.body.requestId).toBe(maxId)
  })

  it('rejects an oversized id and substitutes a fresh opaque one', async () => {
    const res = await agent
      .post('/api/v1/register')
      .set('X-Request-Id', `${'A'.repeat(64)}EVIL`)
      .send({})
      .expect(400)
    expect(res.headers['x-request-id']).not.toContain('EVIL')
    expect(res.body.requestId).toMatch(/^[a-f0-9]{32}$/)
    expect(res.headers['x-request-id']).toBe(res.body.requestId)
  })

  it('rejects ids with spaces or header-injection payloads (log-forging vectors)', async () => {
    // Control characters cannot ride in an HTTP header at all (the client
    // itself refuses); spaces and separators CAN — and must be discarded.
    for (const evil of ['id with spaces', 'id;DROP', 'id=evil', 'id+plus']) {
      const res = await agent.post('/api/v1/register').set('X-Request-Id', evil).send({})
      expect(res.body.requestId, `input: ${evil}`).toMatch(/^[a-f0-9]{32}$/)
      expect(res.body.requestId, `input: ${evil}`).not.toBe(evil)
    }
  })

  it('generates an opaque id when the header is absent', async () => {
    const res = await agent.post('/api/v1/register').send({}).expect(400)
    expect(res.body.requestId).toMatch(/^[a-f0-9]{32}$/)
    expect(res.headers['x-request-id']).toBe(res.body.requestId)
  })
})

describe('error envelope never leaks internals', () => {
  it('validation errors carry field-level details only', async () => {
    const res = await agent.post('/api/v1/register').send({ email: 'nope', password: 'x' }).expect(400)
    expect(res.body.error.details).toEqual([
      { field: 'email', code: 'INVALID_FORMAT' },
      { field: 'password', code: 'TOO_SHORT' },
    ])
    expect(JSON.stringify(res.body)).not.toMatch(/stack|Error:|at \/|node_modules/i)
  })
})
