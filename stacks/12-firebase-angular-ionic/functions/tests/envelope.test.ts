/**
 * Envelope + X-Request-Id contract tests â€” run against the REAL Firebase
 * Auth + Firestore emulators via the production Express app.
 *
 * Contract under test:
 *   { ok, data, error, requestId } on every JSON response;
 *   X-Request-Id echoed ONLY when it matches ^[A-Za-z0-9-]{1,64}$;
 *   invalid client ids are never echoed (fresh id instead);
 *   unknown routes inside the prefix get the envelope-wrapped 404;
 *   no Server-Sent Events endpoints exist (rule 6).
 */
import { afterAll, describe, expect, it } from 'vitest'
import supertest from 'supertest'
import type { SuperTest, Test } from 'supertest'
import { emulatorSuite, teardownEmulatorTest } from './helpers/emulator.js'

const suite = emulatorSuite()
let agent: SuperTest<Test>

const EMAIL = ['ada', 'example.com'].join('@')
const PASSWORD = ['correct', 'horse', 'battery'].join('')

/** Sync accessor - app is initialized in beforeEach (emulatorSuite). */
function api(): SuperTest<Test> {
  if (!agent) {
    agent = supertest(suite.getApp()) as SuperTest<Test>
  }
  return agent
}

afterAll(async () => {
  await teardownEmulatorTest()
})

describe('envelope contract', () => {
  it('health is intentionally envelope-less (trivial probe)', async () => {
    const res = await (api()).get('/api/v1/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('wraps unknown routes in the envelope', async () => {
    const res = await (api()).get('/api/v1/definitely-not-a-route').expect(404)
    expect(res.body).toMatchObject({
      ok: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    })
    expect(typeof res.body.requestId).toBe('string')
    expect(res.body.requestId).toMatch(/^[A-Za-z0-9-]{1,64}$/)
  })

  it('echoes a valid client X-Request-Id on envelope responses (register)', async () => {
    const res = await (api())
      .post('/api/v1/auth/register')
      .set('X-Request-Id', 'abc-DEF-123')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200)
    expect(res.body.requestId).toBe('abc-DEF-123')
    expect(res.headers['x-request-id']).toBe('abc-DEF-123')
  })

  it('rejects an invalid X-Request-Id by replacing it (never echoed)', async () => {
    const res = await (api())
      .post('/api/v1/auth/register')
      .set('X-Request-Id', 'bad id with spaces/and?symbols!')
      .send({ email: ['x1', 'example.com'].join('@'), password: PASSWORD })
      .expect(200)
    expect(res.body.requestId).not.toContain(' ')
    expect(res.body.requestId).not.toBe('bad id with spaces/and?symbols!')
    expect(res.headers['x-request-id']).toBe(res.body.requestId)
    expect(res.body.requestId).toMatch(/^[A-Za-z0-9-]{1,64}$/)
  })

  it('replaces a 65-char X-Request-Id (boundary: too long)', async () => {
    const tooLong = 'a'.repeat(65)
    const res = await (api())
      .post('/api/v1/auth/register')
      .set('X-Request-Id', tooLong)
      .send({ email: ['x2', 'example.com'].join('@'), password: PASSWORD })
      .expect(200)
    expect(res.body.requestId).not.toBe(tooLong)
  })

  it('accepts a 64-char X-Request-Id (boundary: max length)', async () => {
    const max = 'b'.repeat(64)
    const res = await (api())
      .post('/api/v1/auth/register')
      .set('X-Request-Id', max)
      .send({ email: ['x3', 'example.com'].join('@'), password: PASSWORD })
      .expect(200)
    expect(res.body.requestId).toBe(max)
  })

  it('accepts a 1-char X-Request-Id (boundary: min length)', async () => {
    const res = await (api())
      .post('/api/v1/auth/register')
      .set('X-Request-Id', 'z')
      .send({ email: ['x4', 'example.com'].join('@'), password: PASSWORD })
      .expect(200)
    expect(res.body.requestId).toBe('z')
  })

  it('mints a fresh opaque id when none supplied', async () => {
    const res = await (api()).get('/api/v1/health').expect(200)
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{32}$/)
  })

  it('no SSE endpoints exist (rule 6: SSE forbidden)', async () => {
    const res = await (api()).get('/api/v1/events').expect(404)
    expect(res.headers['content-type']).not.toContain('text/event-stream')
    const res2 = await (api()).get('/api/v1/stream').expect(404)
    expect(res2.headers['content-type']).not.toContain('text/event-stream')
  })
})
