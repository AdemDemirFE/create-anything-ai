/**
 * LoginThrottleService — fixed-window rate limiting for the login endpoint,
 * keyed by (lowercased email, TCP peer IP). Fully in-memory (single-process
 * reference server); production deployments would back this with Redis.
 *
 * Config-driven knobs (env -> ConfigService):
 *   LOGIN_THROTTLE_WINDOW_SECONDS, LOGIN_THROTTLE_MAX_FAILURES,
 *   LOGIN_THROTTLE_RETRY_AFTER_SECONDS.
 *
 * When the window is exhausted the caller gets ApiError RATE_LIMITED (429)
 * carrying retryAfterSeconds, which the global filter renders as the
 * Retry-After header.
 */
import { Injectable } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiError } from './api-error.js'
import { ERROR_CODES } from './error-codes.js'

interface WindowState {
  windowStart: number
  failures: number
  lockedUntil: number
}

@Injectable()
export class LoginThrottleService {
  private readonly states = new Map<string, WindowState>()
  /** Injectable clock for deterministic tests. */
  private now: () => number = () => Date.now()

  private readonly windowMs: number
  private readonly maxFailures: number
  private readonly retryAfterSeconds: number

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.windowMs = Math.max(1, config.get<number>('throttle.windowSeconds', 60)) * 1000
    this.maxFailures = Math.max(1, config.get<number>('throttle.maxFailures', 5))
    this.retryAfterSeconds = Math.max(1, config.get<number>('throttle.retryAfterSeconds', 60))
  }

  /** Test hook: freeze/advance time. */
  setClock(fn: () => number): void {
    this.now = fn
  }

  private key(email: string, ip: string): string {
    return `${email.toLowerCase()}|${ip}`
  }

  /**
   * Throws RATE_LIMITED (429) when the identity is locked. Called BEFORE
   * credential verification so locked identities never reach bcrypt.
   */
  assertAllowed(email: string, ip: string): void {
    const state = this.states.get(this.key(email, ip))
    if (!state) return
    const t = this.now()
    if (state.lockedUntil > t) {
      throw new ApiError(
        ERROR_CODES.RATE_LIMITED,
        'Too many failed attempts. Try again later.',
        429,
        [],
        Math.ceil((state.lockedUntil - t) / 1000),
      )
    }
    if (t - state.windowStart > this.windowMs && state.lockedUntil <= t) {
      // Window expired and not locked: reset lazily.
      this.states.delete(this.key(email, ip))
    }
  }

  /** Records a failed attempt; locks the identity at the failure threshold. */
  recordFailure(email: string, ip: string): void {
    const key = this.key(email, ip)
    const t = this.now()
    let state = this.states.get(key)
    if (!state || t - state.windowStart > this.windowMs) {
      // Fresh window; the threshold check below applies to it as well
      // (maxFailures=1 locks on the very first failure).
      state = { windowStart: t, failures: 0, lockedUntil: 0 }
      this.states.set(key, state)
    }
    state.failures += 1
    if (state.failures >= this.maxFailures) {
      state.lockedUntil = t + this.retryAfterSeconds * 1000
    }
  }

  /** Successful login clears the identity's failure history. */
  recordSuccess(email: string, ip: string): void {
    this.states.delete(this.key(email, ip))
  }

  /** Test isolation hook. */
  reset(): void {
    this.states.clear()
    this.now = () => Date.now()
  }
}
