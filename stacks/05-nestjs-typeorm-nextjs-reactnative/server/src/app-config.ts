/**
 * Config namespaces for ConfigModule (load: [appConfig...]).
 * Every knob reads env with a safe dev default; tests set process.env
 * BEFORE module creation to override.
 */
import { registerAs } from '@nestjs/config'

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

export const sessionConfig = registerAs('session', () => ({
  ttlMinutes: intFromEnv('SESSION_TTL_MINUTES', 30),
  cookieName: process.env['COOKIE_NAME'] ?? 'stack05_session',
  secureCookies: boolFromEnv('SECURE_COOKIES', false),
}))

export const throttleConfig = registerAs('throttle', () => ({
  windowSeconds: intFromEnv('LOGIN_THROTTLE_WINDOW_SECONDS', 60),
  maxFailures: intFromEnv('LOGIN_THROTTLE_MAX_FAILURES', 5),
  retryAfterSeconds: intFromEnv('LOGIN_THROTTLE_RETRY_AFTER_SECONDS', 60),
}))

export const algorithmConfig = registerAs('algorithm', () => ({
  maxInput: intFromEnv('ALGORITHM_MAX_INPUT', 10_000),
}))

export const passwordConfig = registerAs('password', () => ({
  workers: intFromEnv('PASSWORD_WORKERS', 4),
}))

export const appConfigs = [sessionConfig, throttleConfig, algorithmConfig, passwordConfig]

export const DEFAULT_PORT = 4000
export const DEFAULT_COOKIE_NAME = 'stack05_session'
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000']
