/**
 * Failed-login throttle: fixed window, in-process, keyed email + client IP.
 *
 * Behavior (all test-asserted):
 * - Counts only FAILED attempts; a successful login clears the tally.
 * - Once `maxFailures` failures are inside the window, every further attempt
 *   (even with correct credentials) gets 429 + Retry-After.
 * - The window length comes ENTIRELY from the caller-provided config
 *   (Stack-18 review lesson: the window check must use the configured
 *   window, never a hard-coded 60s — a config of 2s must open a fresh
 *   window at t+3s, and a test pins exactly that).
 * - Client identity is the TCP peer address (`req.socket.remoteAddress`).
 *   X-Forwarded-For is deliberately NOT honored: without a trusted-proxy
 *   configuration any client could rotate spoofed identities to defeat the
 *   throttle (Stack-01 lesson).
 *
 * Review follow-up hardening:
 * - ATOMIC reserve: `reserveLogin` performs the throttle check and the
 *   failure-slot accounting in ONE synchronous step (optimistic slot
 *   reservation, refunded via `release()` on unexpected errors and wiped by
 *   `clearFailures()` on success). The old shape — `isThrottled` before the
 *   bcrypt await and `recordFailure` after it — let a concurrent burst all
 *   pass the check and all record afterwards, blowing past maxFailures and
 *   spending a bcrypt verification per request. A race test pins that a
 *   20-deep burst against maxFailures=5 yields exactly 5 verifications and
 *   15 immediate 429s.
 * - BOUNDED memory: the tally Map is a bounded LRU (oldest-touched key
 *   evicted past `MAX_ENTRIES`) plus a lazy sweep of expired rows, so a
 *   spray of unique emails/IPs cannot grow the process without bound.
 */
import type { Request } from 'express'

interface FailureRecord {
  count: number
  windowStart: number
  /** Logical clock tick of the last touch, for LRU eviction. */
  touchedAt: number
}

/** Bounded tally store: the oldest-touched key is evicted once this is hit. */
const failures = new Map<string, FailureRecord>()

/**
 * Upper bound on tracked keys. Each entry is ~100 bytes, so the ceiling is
 * well under a megabyte; attackers spraying unique emails cannot grow the
 * store beyond it. The lazy sweep below keeps even the steady state small.
 */
const MAX_ENTRIES = 10_000

/** Sweep cadence: expired rows are lazily dropped at most once per this many ms. */
const PRUNE_INTERVAL_MS = 30_000
let lastPruneAt = 0
let tickClock = 0

function tick(): number {
  tickClock += 1
  return tickClock
}

/** Test/ops helper: number of keys currently tracked. */
export function tallySize(): number {
  return failures.size
}

function evictColdest(): void {
  if (failures.size < MAX_ENTRIES) return
  // LRU: every touch re-sets the entry, so Map insertion order agrees with
  // touchedAt — the first keys iterated are the coldest.
  let overflow = failures.size - MAX_ENTRIES + 1
  for (const key of failures.keys()) {
    failures.delete(key)
    overflow -= 1
    if (overflow <= 0) break
  }
}

function pruneExpired(windowMs: number, atMs: number): void {
  if (atMs - lastPruneAt < PRUNE_INTERVAL_MS) return
  lastPruneAt = atMs
  for (const [key, record] of failures) {
    if (atMs - record.windowStart > windowMs) failures.delete(key)
  }
}

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

export interface LoginReservation {
  /**
   * True when the caller is over the failure budget for this window and
   * must be refused (429 + Retry-After) WITHOUT spending a bcrypt
   * verification.
   */
  throttled: boolean
  /**
   * Refunds the optimistically reserved slot. Call this ONLY on the
   * unexpected-error path (the attempt neither failed nor succeeded — e.g.
   * the DB threw mid-lookup) so infrastructure failures do not count
   * toward the login throttle. Failure paths keep the slot; success calls
   * `clearFailures`.
   */
  release(): void
}

/**
 * Atomically reserves one login attempt: reads the throttle state AND
 * accounts for the attempt (an optimistically reserved failure slot) in a
 * single synchronous step, so no interleaving of concurrent requests can
 * slip a burst past maxFailures. The route calls this BEFORE the user
 * lookup, refuses with 429 when `throttled`, and the outcome resolves the
 * reservation: failure keeps the slot, success wipes the tally
 * (`clearFailures`), unexpected errors refund it (`release`).
 */
export function reserveLogin(
  email: string,
  ip: string,
  config: ThrottleConfig,
  nowMs = Date.now(),
): LoginReservation {
  const key = keyFor(email, ip)
  const windowMs = config.windowSeconds * 1000

  pruneExpired(windowMs, nowMs)

  const existing = failures.get(key)
  const expired = existing !== undefined && nowMs - existing.windowStart > windowMs

  let throttled: boolean
  if (existing === undefined || expired) {
    // Fresh (or expired) window: this attempt occupies slot 1. It can only
    // be throttled outright if maxFailures is configured below 1.
    evictColdest()
    failures.set(key, { count: 1, windowStart: nowMs, touchedAt: tick() })
    throttled = 1 > config.maxFailures
  } else {
    existing.count += 1
    existing.touchedAt = tick()
    // The attempt is refused once the count of attempts inside the window
    // exceeds the failure budget (the first maxFailures attempts get their
    // real verdict; everything after is 429 without a bcrypt spend).
    throttled = existing.count > config.maxFailures
  }

  return {
    throttled,
    release() {
      const record = failures.get(key)
      if (!record) return
      record.count = Math.max(0, record.count - 1)
    },
  }
}

/**
 * Clears the tally after a SUCCESSFUL login. A failure recorded for the
 * same key afterwards simply starts a fresh window.
 */
export function clearFailures(email: string, ip: string): void {
  failures.delete(keyFor(email, ip))
}

/** Test/ops helper: drops every tally. */
export function resetThrottle(): void {
  failures.clear()
  lastPruneAt = 0
}
