/**
 * Login throttle — fixed window keyed by (normalized email | peer IP).
 *
 * Stack-19 lessons carried over:
 *  - All knobs (window, max attempts, Retry-After) come from config — the
 *    two time values are SEPARATE knobs and must not be coupled.
 *  - Bounded memory: fixed-cap LRU map with periodic prune; an attacker
 *    rotating identities cannot grow the map without bound.
 *  - 429 always carries Retry-After (seconds) in both header and envelope.
 *  - Failure only: successful logins never consume window capacity.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ApiError } from './envelope.js'
import { ErrorCodes } from './error-codes.js'
import { config } from './config.js'

interface WindowEntry {
  /** Window start (ms epoch). */
  start: number
  count: number
  /** Last hit (ms epoch) — LRU touch. */
  last: number
}

const CAP = 5_000

const windows = new Map<string, WindowEntry>()

/** Test hook: reset all windows. */
export function resetThrottle(): void {
  windows.clear()
}

/** Current size — exposed for tests only. */
export function throttleSize(): number {
  return windows.size
}

function keyFor(req: Request, email: string): string {
  const ip = req.socket.remoteAddress ?? 'unknown'
  return `${email}|${ip}`
}

function pruneExpired(now: number): void {
  for (const [k, entry] of windows) {
    if (now - entry.start >= config.throttle.loginWindowMs) windows.delete(k)
  }
}

/** Touch = delete+set to keep insertion order = recency for LRU eviction. */
function touch(key: string, entry: WindowEntry): void {
  windows.delete(key)
  windows.set(key, entry)
}

function evictLru(): void {
  const oldest = windows.keys().next()
  if (!oldest.done) windows.delete(oldest.value)
}

/**
 * Express middleware factory. Counts only FAILED login attempts inside a
 * fixed window; when the count exceeds max, further attempts get
 * 429 + Retry-After without ever touching Auth (fail closed, cheap).
 */
export function loginThrottle(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const emailRaw = (req.body as { email?: unknown } | undefined)?.email
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : ''
    const key = keyFor(req, email)
    const now = Date.now()
    const entry = windows.get(key)

    if (entry && now - entry.start < config.throttle.loginWindowMs && entry.count >= config.throttle.loginMaxAttempts) {
      const headers = { 'Retry-After': String(config.throttle.loginRetryAfterSeconds) }
      const { requestId } = req
      res.setHeader('Retry-After', String(config.throttle.loginRetryAfterSeconds))
      res.status(429).json({
        ok: false,
        data: null,
        error: { code: ErrorCodes.RateLimited, message: 'Too many attempts. Retry later.' },
        requestId: requestId ?? '',
      })
      return
    }

    pruneExpired(now)

    // Expose a report() the route calls exactly once per failed attempt.
    res.locals.throttleReport = () => {
      const existing = windows.get(key)
      if (!existing || now - existing.start >= config.throttle.loginWindowMs) {
        if (windows.size >= CAP) evictLru()
        touch(key, { start: now, count: 1, last: now })
      } else {
        existing.count += 1
        existing.last = now
        if (windows.size >= CAP && !windows.has(key)) evictLru()
        touch(key, existing)
      }
    }
    next()
  }
}

/** Called by the login route on every FAILED attempt. */
export function reportLoginFailure(res: Response): void {
  const report = res.locals.throttleReport as (() => void) | undefined
  if (typeof report === 'function') report()
}
