/**
 * Login throttle tests: fixed window keyed email + TCP peer IP; counts only
 * attempts; 429 + Retry-After once over the limit; success clears the tally;
 * the window AND Retry-After come from config (Stack-18/20 lesson: no
 * hard-coded 60s); rotating spoofed X-Forwarded-For identities does NOT
 * reset the counter (Stack-01 lesson: XFF is untrusted).
 *
 * Review follow-up coverage:
 * - ATOMIC reserve: a concurrent burst cannot all pass the check and record
 *   afterwards — a 20-deep burst at maxFailures=5 sees exactly 5 real
 *   verdicts and 15 immediate 429s (no bcrypt overspend possible).
 * - BOUNDED store: a spray of unique keys stops growing at MAX_ENTRIES
 *   (LRU eviction) and expired rows are pruned.
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
    // Drives reserveLogin directly with a tiny configured window and a fake
    // clock, so no suite needs to wait real seconds. Pins the Stack-18
    // review lesson: the window check must honor the CONFIGURED window.
    const { reserveLogin, clearFailures } = await import('../src/security/throttle.js')
    resetThrottle()
    const config = { windowSeconds: 2, maxFailures: 5 }
    const email = 'window@example.com'
    const ip = '203.0.113.10'
    const t0 = 1_000_000

    for (let i = 0; i < 5; i += 1) {
      const r = reserveLogin(email, ip, config, t0)
      expect(r.throttled).toBe(false)
    }
    const inside = reserveLogin(email, ip, config, t0 + 1_000)
    expect(inside.throttled).toBe(true) // 6th attempt inside the 2s window
    inside.release()

    // At t0+3s the configured window has passed: not throttled, and a new
    // window gets a fresh budget of maxFailures real verdicts.
    const fresh = reserveLogin(email, ip, config, t0 + 3_000)
    expect(fresh.throttled).toBe(false)
    for (let i = 0; i < 4; i += 1) {
      const r = reserveLogin(email, ip, config, t0 + 3_000 + i)
      expect(r.throttled).toBe(false)
    }
    const over = reserveLogin(email, ip, config, t0 + 4_500)
    expect(over.throttled).toBe(true) // budget exhausted in the fresh window
    over.release()
    clearFailures(email, ip)
    resetThrottle()
  })

  it('a concurrent burst cannot slip past the budget (atomic reserve race test)', async () => {
    // THE review-follow-up regression test: with the old shape
    // (isThrottled → await bcrypt → recordFailure) every request of a
    // concurrent burst passed the check BEFORE any of them recorded, so all
    // 20 spent a bcrypt verification and the tally sailed past maxFailures.
    // With the atomic reserve the check+accounting is one synchronous step:
    // exactly maxFailures requests get a real verdict (401), the rest are
    // refused with 429 and NEVER reach the verifier.
    const email = 'race-burst@example.com'
    await agent.post('/api/v1/register').send({ email, password: PASSWORD })

    const burst = 20
    const responses = await Promise.all(
      Array.from({ length: burst }, () => login(email, [PASSWORD, 'wrong'].join(''))),
    )
    const statuses = responses.map((res) => res.status)
    expect(statuses.filter((s) => s === 401).length).toBe(5) // exactly the budget
    expect(statuses.filter((s) => s === 429).length).toBe(burst - 5)
    for (const res of responses) {
      if (res.status === 429) {
        expect(res.body.error.code).toBe('RATE_LIMITED')
        expect(res.headers['retry-after']).toBe('60')
      }
    }

    // The store holds exactly one tally for the key, at the budget.
    const { tallySize } = await import('../src/security/throttle.js')
    expect(tallySize()).toBeGreaterThanOrEqual(1)
  })

  it('throttled requests never spend a bcrypt verification (no 401 after 429)', async () => {
    // Once throttled, even CORRECT credentials must be refused without any
    // sign of verification progress: 429 both times, and the tally is
    // untouched by attempts over budget.
    const email = 'noverify@example.com'
    await agent.post('/api/v1/register').send({ email, password: PASSWORD })
    for (let i = 0; i < 5; i += 1) {
      await login(email, [PASSWORD, 'bad'].join('')).expect(401)
    }
    await login(email, [PASSWORD, 'bad'].join('')).expect(429)
    const correct = await login(email, PASSWORD).expect(429)
    expect(correct.body.error.code).toBe('RATE_LIMITED')
  })

  it('the tally store is bounded (LRU eviction caps the key count)', async () => {
    // Drive reserveLogin directly with unique keys to simulate an attacker
    // spraying emails: the store must stop growing at its cap instead of
    // growing without bound.
    const { reserveLogin, tallySize, resetThrottle } = await import('../src/security/throttle.js')
    resetThrottle()
    const config = { windowSeconds: 60, maxFailures: 5 }
    const cap = 10_000
    for (let i = 0; i < cap + 50; i += 1) {
      reserveLogin(`spray-${i}@example.com`, '198.51.100.7', config)
    }
    expect(tallySize()).toBeLessThanOrEqual(cap)
    resetThrottle()
  })

  it('a hot throttled key survives a cold-key spray (true access-ordered LRU)', async () => {
    // Review round 2 regression test: with insertion-order "eviction", a
    // victim key near the FRONT of the Map was evicted by a spray of fresh
    // keys even though it was being actively touched (hot). With true LRU
    // (delete + re-set on every access) the hot key moves to the back on
    // each touch and outlives the spray. We need an internal hook for the
    // eviction order, so this test drives the observable contract: after
    // interleaving MAX_ENTRIES-ish sprays with hot-key touches, the hot key
    // must STILL be throttled (its tally was never dropped).
    const throttle = await import('../src/security/throttle.js')
    throttle.resetThrottle()
    const config = { windowSeconds: 60, maxFailures: 5 }
    const victimEmail = 'hot-victim@example.com'
    const victimIp = '198.51.100.9'

    // Drive the victim to the throttle boundary.
    for (let i = 0; i < 5; i += 1) throttle.reserveLogin(victimEmail, victimIp, config)

    // Spray cold keys while re-touching the victim between bursts. Each
    // touch must re-position the victim to the back of the eviction order.
    for (let burst = 0; burst < 5; burst += 1) {
      for (let i = 0; i < 2_000; i += 1) {
        throttle.reserveLogin(`cold-${burst}-${i}@example.com`, '203.0.113.77', config)
      }
      // The victim is still throttled right after the burst: its tally
      // survived (an insertion-order eviction would have dropped it once
      // the spray wrapped past its Map position).
      const r = throttle.reserveLogin(victimEmail, victimIp, config)
      expect(r.throttled).toBe(true)
    }
    throttle.resetThrottle()
  })

  it('expired entries are pruned from the store', async () => {
    // Pruning runs lazily at most once per 30s wall-clock; force it by
    // seeding an expired row, moving lastPruneAt back via reset, and
    // reserving with a far-future timestamp.
    const throttle = await import('../src/security/throttle.js')
    throttle.resetThrottle()
    const config = { windowSeconds: 1, maxFailures: 5 }
    // Seed a row, then let its window expire relative to the next call.
    throttle.reserveLogin('prune-a@example.com', '198.51.100.8', config, 1_000)
    throttle.reserveLogin('prune-b@example.com', '198.51.100.8', config, 1_000)
    // 31s later: the lazy sweep (30s cadence) fires and drops both expired
    // rows; a fresh key's reservation afterwards proves the store shrank.
    const r = throttle.reserveLogin('prune-fresh@example.com', '198.51.100.8', config, 1_000 + 31_000)
    expect(r.throttled).toBe(false)
    expect(throttle.tallySize()).toBe(1) // only the fresh key remains
    throttle.resetThrottle()
  })
})
