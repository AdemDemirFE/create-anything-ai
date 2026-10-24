/**
 * Failed-login throttle: fixed window, in-process, keyed email + client IP.
 *
 * Behavior (all test-asserted):
 * - Counts only FAILED attempts; a successful login clears the tally.
 * - Once `maxFailures` failures are inside the window, every further attempt
 *   (even with correct credentials) gets 429 + Retry-After.
 * - Client identity is the TCP peer address (`req.socket.remoteAddress`).
 *   X-Forwarded-For is deliberately NOT honored: without a trusted-proxy
 *   configuration any client could rotate spoofed identities to defeat the
 *   throttle (Stack-01 lesson).
 */
import type { Request } from 'express'

interface FailureRecord {
  count: number
  windowStart: number
}

const failures = new Map<string, FailureRecord>()

export function clientIp(req: Request): string {
  return req.socket.remoteAddress ?? 'unknown'
}

function keyFor(email: string, ip: string): string {
  return `${ip}::${email.toLowerCase()}`
}

export interface ThrottleConfig {
  windowSeconds: number
  maxFailures: number
}

export function isThrottled(email: string, ip: string, config: ThrottleConfig, now = Date.now()): boolean {
  const record = failures.get(keyFor(email, ip))
  if (!record) return false
  if (now - record.windowStart > config.windowSeconds * 1000) {
    failures.delete(keyFor(email, ip))
    return false
  }
  return record.count >= config.maxFailures
}

export function recordFailure(email: string, ip: string, config: ThrottleConfig, now = Date.now()): void {
  const key = keyFor(email, ip)
  const record = failures.get(key)
  if (!record) {
    failures.set(key, { count: 1, windowStart: now })
    return
  }
  // Same fixed window that isThrottled uses: past the window a new one starts.
  if (now - record.windowStart > config.windowSeconds * 1000) {
    failures.set(key, { count: 1, windowStart: now })
    return
  }
  record.count += 1
}

export function clearFailures(email: string, ip: string): void {
  failures.delete(keyFor(email, ip))
}

/** Test/ops helper: drops every tally. */
export function resetThrottle(): void {
  failures.clear()
}
