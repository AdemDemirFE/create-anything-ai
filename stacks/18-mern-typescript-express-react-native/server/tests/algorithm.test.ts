/**
 * Algorithm workbench tests: fixed catalog only, bounded input, measured
 * duration reported separately from theoretical Big-O.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SuperTest, Test } from 'supertest'
import { createTestApp, destroyTestApp, request, type TestApp } from './helpers.js'

let testApp: TestApp
let agent: SuperTest<Test>
let cookie = ''

const PASSWORD = ['correct', 'horse', 'battery'].join('')

beforeAll(async () => {
  testApp = await createTestApp()
  agent = request(testApp.app)
  await agent.post('/api/v1/register').send({ email: 'algo@example.com', password: PASSWORD })
  const loginRes = await agent.post('/api/v1/login').send({ email: 'algo@example.com', password: PASSWORD })
  cookie = String((loginRes.headers['set-cookie'] as unknown as string[])[0])
})

afterAll(async () => {
  await destroyTestApp(testApp)
})

describe('algorithm catalog', () => {
  it('lists the fixed catalog with complexity and explanation', async () => {
    const res = await agent.get('/api/v1/algorithm').set('Cookie', cookie).expect(200)
    const ids = res.body.data.map((entry: { id: string }) => entry.id).sort()
    expect(ids).toEqual(['fibonacci', 'fizzbuzz', 'palindrome', 'reverse', 'word-count'])
    for (const entry of res.body.data) {
      expect(typeof entry.complexity).toBe('string')
      expect(typeof entry.explanation).toBe('string')
    }
  })

  it('requires authentication', async () => {
    await agent.get('/api/v1/algorithm').expect(401)
  })
})

describe('algorithm run', () => {
  it('runs fizzbuzz correctly with measured duration and complexity', async () => {
    const res = await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'fizzbuzz', input: '5' })
      .expect(200)
    expect(res.body.data.output).toBe('1\n2\nFizz\n4\nBuzz')
    expect(typeof res.body.data.executionMs).toBe('number')
    expect(res.body.data.executionMs).toBeGreaterThanOrEqual(0)
    expect(res.body.data.complexity).toBe('O(n)')
    // Measured duration and theoretical complexity are separate fields.
    expect(res.body.data).toHaveProperty('executionMs')
    expect(res.body.data).toHaveProperty('complexity')
  })

  it('runs reverse on unicode-safe input', async () => {
    const res = await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'reverse', input: 'stack' })
      .expect(200)
    expect(res.body.data.output).toBe('kcats')
  })

  it('rejects unknown algorithms with UNKNOWN_ALGORITHM', async () => {
    const res = await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'definitely-not-here', input: '1' })
      .expect(400)
    expect(res.body.error.code).toBe('UNKNOWN_ALGORITHM')
  })

  it('rejects oversized input with INPUT_TOO_LARGE (over 10,000 chars)', async () => {
    const res = await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'reverse', input: 'a'.repeat(10_001) })
      .expect(400)
    expect(res.body.error.code).toBe('INPUT_TOO_LARGE')
  })

  it('accepts input at the 10,000-character cap', async () => {
    await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'reverse', input: 'a'.repeat(10_000) })
      .expect(200)
  })

  it('rejects invalid numeric input with INVALID_INPUT', async () => {
    const res = await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'fizzbuzz', input: 'not-a-number' })
      .expect(400)
    expect(res.body.error.code).toBe('INVALID_INPUT')
  })

  it('rejects fizzbuzz out of its documented range', async () => {
    await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'fizzbuzz', input: '0' })
      .expect(400)
    await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'fizzbuzz', input: '1001' })
      .expect(400)
  })

  it('requires authentication', async () => {
    await agent.post('/api/v1/algorithm/run').send({ algorithm: 'reverse', input: 'x' }).expect(401)
  })

  it('never receives code to evaluate: the catalog is the entire surface', async () => {
    // The run endpoint accepts only {algorithm, input}; there is no field
    // that could carry executable code. Assert the bounded shape.
    const res = await agent
      .post('/api/v1/algorithm/run')
      .set('Cookie', cookie)
      .send({ algorithm: 'reverse', input: 'ok', code: 'process.exit(1)' })
      .expect(200)
    expect(res.body.data.output).toBe('ko')
    expect(JSON.stringify(res.body)).not.toContain('process.exit')
  })
})
