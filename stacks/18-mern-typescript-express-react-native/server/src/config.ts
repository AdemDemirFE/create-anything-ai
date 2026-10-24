/**
 * Environment configuration for the Stack 18 server.
 *
 * Every value has a safe default for local development; none of them is a
 * secret. No runtime secret is required at all: session tokens are generated
 * per session with the OS CSPRNG and only SHA-256 digests are stored.
 */
import os from 'node:os'

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Environment variable ${name} must be an integer between ${min} and ${max}.`)
  }
  return parsed
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

export interface Config {
  port: number
  /** MongoDB connection string. Tests always use mongodb-memory-server. */
  mongoUri: string
  /** Session lifetime in minutes; sliding (idle) timeout. */
  sessionTtlMinutes: number
  /** Set the Secure cookie flag (only when serving over TLS). */
  secureCookies: boolean
  /** CORS allowlist (browser clients); empty means same-origin/dev only. */
  allowedOrigins: string[]
  /** Failed-login throttle window in seconds. */
  throttleWindowSeconds: number
  /** Maximum failed login attempts inside the window before 429. */
  throttleMaxFailures: number
  /** Seconds advertised in Retry-After once throttled. */
  throttleRetryAfterSeconds: number
  /** Bcrypt cost factor (bcryptjs, run inside worker threads). */
  bcryptRounds: number
  /** Worker-thread pool size for bcrypt hashing. */
  bcryptWorkers: number
}

function allowedOriginsFromEnv(): string[] {
  const raw = process.env.ALLOWED_ORIGINS
  if (raw === undefined || raw.trim() === '') return []
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: intFromEnv('PORT', 4000, 1, 65_535),
    mongoUri: env.MONGODB_URI ?? 'mongodb://localhost:27017/stack18',
    sessionTtlMinutes: intFromEnv('SESSION_TTL_MINUTES', 30, 1, 24 * 60),
    secureCookies: boolFromEnv('SECURE_COOKIES', false),
    allowedOrigins: allowedOriginsFromEnv(),
    throttleWindowSeconds: intFromEnv('LOGIN_THROTTLE_WINDOW_SECONDS', 60, 1, 3600),
    throttleMaxFailures: intFromEnv('LOGIN_THROTTLE_MAX_FAILURES', 5, 1, 100),
    throttleRetryAfterSeconds: intFromEnv('LOGIN_THROTTLE_RETRY_AFTER_SECONDS', 60, 1, 3600),
    bcryptRounds: intFromEnv('BCRYPT_ROUNDS', 12, 4, 15),
    bcryptWorkers: intFromEnv('BCRYPT_WORKERS', Math.min(4, Math.max(1, os.availableParallelism() - 1)), 1, 16),
  }
}
