/**
 * Login throttle tests: fixed window keyed email + TCP peer IP; counts only
 * failures; 429 + Retry-After once over the limit; success clears the tally;
 * the window AND Retry-After come from config (Stack-18/20 lesson: no
 * hard-coded 60s); rotating spoofed X-Forwarded-For identities does NOT
 * reset the counter (Stack-01 lesson: XFF is untrusted).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SuperTest, Test } from 'supertest'
import { createTestApp, destroyTestApp, request, resetThrottle, type TestApp } from './helpers.js'

let testApp: TestApp
let agent: SuperTest<Test>

const PASSWORD = ['correct', 'horse', 'battery'].join('')
const EMAIL = 'throttle@example.com'

beforeAll(async () => {
  testApp = await createTestApp({
    throttleWindowSeconds: 60,
    throttleMaxFailures: 5,
    throttleRetryAfterSeconds: 60,
  })
  agent = request(testApp.app)
})

afterAll(async () => {
  await destroyTestApp(testApp)
})

function login(email: string, password: string) {
  return agent.post('/api/v1/login').send({ email, password })
}

async function ensureUser(): Promise<void> {
  await agent.post('/api/v1/register').send({ email: EMAIL, password: PASSWORD })
}

describe('login throttle', () => {
  it('allows a correct login after failures under the limit', async () => {
    await ensureUser()
    await login(EMAIL, [PASSWORD, 'nope'].join('')).expect(401)
    await login(EMAIL, PASSWORD).expect(200)
  })

  it('returns 429 + Retry-After after the configured number of failures', async () => {
    await ensureUser()
    // Fresh email so earlier tests do not leak tally.
    const email = 'burst@example.com'
    for (let i = 0; i < 5; i += 1) {
      await login(email, [PASSWORD, 'bad'].join('')).expect(401)
    }
    const res = await login(email, [PASSWORD, 'bad'].join('')).expect(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
    expect(res.headers['retry-after']).toBe('60')
    // Even the CORRECT password is refused while throttled.
    const correct = await login(email, PASSWORD).expect(429)
    expect(correct.body.error.code).toBe('RATE_LIMITED')
  })

  it('success clears the failure tally', async () => {
    const email = 'clear@example.com'
    await agent.post('/api/v1/register').send({ email, password: PASSWORD })
    await login(email, [PASSWORD, 'bad'].join('')).expect(401)
    await login(email, [PASSWORD, 'bad'].join('')).expect(401)
    await login(email, PASSWORD).expect(200) // success resets
    // Two more failures must NOT hit 429 (tally restarted at the success).
    await login(email, [PASSWORD, 'bad'].join('')).expect(401)
    await login(email, [PASSWORD, 'bad'].join('')).expect(401)
    await login(email, PASSWORD).expect(200)
  })

  it('rotating spoofed X-Forwarded-For does not reset the counter', async () => {
    const email = 'xff@example.com'
    await agent.post('/api/v1/register').send({ email, password: PASSWORD })
    for (let i = 0; i < 5; i += 1) {
      await agent
        .post('/api/v1/login')
        .set('X-Forwarded-For', `10.0.0.${i + 1}`)
        .send({ email, password: [PASSWORD, 'bad'].join('') })
        .expect(401)
    }
    // A "fresh" spoofed identity is still throttled: the key is the socket IP.
    await agent
      .post('/api/v1/login')
      .set('X-Forwarded-For', '10.9.9.9')
      .send({ email, password: PASSWORD })
      .expect(429)
  })

  it('different accounts are throttled independently', async () => {
    const a = 'independent-a@example.com'
    const b = 'independent-b@example.com'
    for (const email of [a, b]) {
      await agent.post('/api/v1/register').send({ email, password: PASSWORD })
    }
    for (let i = 0; i < 5; i += 1) {
      await login(a, [PASSWORD, 'bad'].join('')).expect(401)
    }
    await login(a, PASSWORD).expect(429)
    // The other account is unaffected.
    await login(b, PASSWORD).expect(200)
  })

  it('window expiry uses the configured seconds, not a hard-coded 60s', async () => {
    // Drives recordFailure/isThrottled directly with a tiny configured window
    // and a fake clock, so no suite needs to wait real seconds. Pins the
    // Stack-18 review lesson: BOTH isThrottled and recordFailure must honor
    // the configured window.
    const { isThrottled, recordFailure } = await import('../src/security/throttle.js')
    resetThrottle()
    const config = { windowSeconds: 2, maxFailures: 5 }
    const email = 'window@example.com'
    const ip = '203.0.113.10'
    const t0 = 1_000_000

    for (let i = 0; i < 5; i += 1) recordFailure(email, ip, config, t0)
    expect(isThrottled(email, ip, config, t0 + 1_000)).toBe(true) // inside the 2s window

    // At t0+3s the configured window has passed: not throttled, and a new
    // failure opens a FRESH window with count 1.
    expect(isThrottled(email, ip, config, t0 + 3_000)).toBe(false)
    recordFailure(email, ip, config, t0 + 3_000)
    expect(isThrottled(email, ip, config, t0 + 4_500)).toBe(false) // 1 failure in the fresh window
    for (let i = 0; i < 4; i += 1) recordFailure(email, ip, config, t0 + 4_500)
    expect(isThrottled(email, ip, config, t0 + 4_500)).toBe(true) // 5 in the fresh window -> throttled
    resetThrottle()
  })
})
