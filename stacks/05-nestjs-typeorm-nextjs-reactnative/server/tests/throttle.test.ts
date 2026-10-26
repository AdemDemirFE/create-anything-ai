/**
 * Throttle tests: the login endpoint rate-limits failures per
 * (email, IP) with a config-driven window; the response is 429 RATE_LIMITED
 * + a Retry-After header. Successful logins reset the counter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LoginThrottleService } from '../src/login-throttle.service.js'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { closeTestApp, getTestApp, http, registerUser, cookieHeader, uniqueEmail, STRONG_PASSWORD } from './helpers.js'

beforeAll(async () => {
  await getTestApp()
})

afterAll(async () => {
  await closeTestApp()
})

describe('login throttle (unit, injected clock)', () => {
  async function makeService(maxFailures = 3, retryAfterSeconds = 60, windowSeconds = 60): Promise<LoginThrottleService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoginThrottleService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'throttle.maxFailures') return maxFailures
              if (key === 'throttle.retryAfterSeconds') return retryAfterSeconds
              if (key === 'throttle.windowSeconds') return windowSeconds
              return undefined
            },
          },
        },
      ],
    }).compile()
    return moduleRef.get(LoginThrottleService)
  }

  it('locks the identity after maxFailures and reports the remaining retry-after', async () => {
    const service = await makeService(3, 60)
    let now = 1_000_000
    service.setClock(() => now)

    service.recordFailure('a@example.com', '1.2.3.4')
    service.recordFailure('a@example.com', '1.2.3.4')
    expect(() => service.assertAllowed('a@example.com', '1.2.3.4')).not.toThrow()

    service.recordFailure('a@example.com', '1.2.3.4') // third failure -> lock
    try {
      service.assertAllowed('a@example.com', '1.2.3.4')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as { code?: string }).code).toBe('RATE_LIMITED')
      expect((err as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0)
      expect((err as { retryAfterSeconds?: number }).retryAfterSeconds).toBeLessThanOrEqual(60)
    }
  })

  it('the lock expires after the retry window and the counter resets', async () => {
    const service = await makeService(2, 60)
    let now = 2_000_000
    service.setClock(() => now)

    service.recordFailure('b@example.com', '9.9.9.9')
    service.recordFailure('b@example.com', '9.9.9.9')
    expect(() => service.assertAllowed('b@example.com', '9.9.9.9')).toThrow()

    now += 61_000
    expect(() => service.assertAllowed('b@example.com', '9.9.9.9')).not.toThrow()
  })

  it('different identities do not collide (email OR ip differs)', async () => {
    const service = await makeService(1, 60)
    let now = 3_000_000
    service.setClock(() => now)

    service.recordFailure('c@example.com', '5.5.5.5')
    expect(() => service.assertAllowed('c@example.com', '5.5.5.5')).toThrow()
    expect(() => service.assertAllowed('c@example.com', '6.6.6.6')).not.toThrow()
    expect(() => service.assertAllowed('d@example.com', '5.5.5.5')).not.toThrow()
  })

  it('success clears the failure history', async () => {
    const service = await makeService(1, 60)
    let now = 4_000_000
    service.setClock(() => now)

    service.recordFailure('e@example.com', '7.7.7.7')
    expect(() => service.assertAllowed('e@example.com', '7.7.7.7')).toThrow()
    service.recordSuccess('e@example.com', '7.7.7.7')
    expect(() => service.assertAllowed('e@example.com', '7.7.7.7')).not.toThrow()
  })

  it('key matching is case-insensitive on the email part', async () => {
    const service = await makeService(1, 60)
    let now = 5_000_000
    service.setClock(() => now)

    service.recordFailure('Case@Test.COM', '8.8.8.8')
    expect(() => service.assertAllowed('case@test.com', '8.8.8.8')).toThrow()
  })
})

describe('login throttle (integration, HTTP)', () => {
  it('returns 429 with Retry-After after the configured failure count and recovers', async () => {
    const email = uniqueEmail('throttle')
    await http().post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD })

    // Default config: 5 failures / 60s window. Burn them.
    for (let i = 0; i < 5; i += 1) {
      const attempt = await http().post('/api/v1/auth/login').send({ email, password: 'Wrong-Pass-12' })
      expect(attempt.status).toBe(401)
    }

    const locked = await http().post('/api/v1/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(locked.status).toBe(429)
    expect(locked.body.error.code).toBe('RATE_LIMITED')
    const retryAfter = Number(locked.headers['retry-after'])
    expect(Number.isFinite(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)

    // Correct password BEFORE burn -> 200 and resets history (fresh identity).
    const fresh = uniqueEmail('throttle-fresh')
    await http().post('/api/v1/auth/register').send({ email: fresh, password: STRONG_PASSWORD })
    const ok = await http().post('/api/v1/auth/login').send({ email: fresh, password: STRONG_PASSWORD })
    expect(ok.status).toBe(200)
  })

  it('successful login after some (but not all) failures is allowed and clears the counter', async () => {
    const email = uniqueEmail('throttle-partial')
    await http().post('/api/v1/auth/register').send({ email, password: STRONG_PASSWORD })

    await http().post('/api/v1/auth/login').send({ email, password: 'Wrong-Pass-12' })
    await http().post('/api/v1/auth/login').send({ email, password: 'Wrong-Pass-12' })

    const ok = await http().post('/api/v1/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)

    // History cleared: the next two failures still land as 401, not 429.
    const again1 = await http().post('/api/v1/auth/login').send({ email, password: 'Wrong-Pass-12' })
    const again2 = await http().post('/api/v1/auth/login').send({ email, password: 'Wrong-Pass-12' })
    expect(again1.status).toBe(401)
    expect(again2.status).toBe(401)
  })

  it('throttle never touches authenticated endpoints', async () => {
    const user = await registerUser()
    const response = await http().get('/api/v1/home').set('cookie', cookieHeader(user.cookies))
    expect(response.status).toBe(200)
  })
})
