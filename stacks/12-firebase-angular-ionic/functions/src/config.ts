/**
 * Stack 12 configuration — every runtime knob is environment-driven with a
 * safe local default, mirroring the Stack-19 lesson: nothing that changes
 * behavior (throttle windows, bounds, ports, project ids) may be hard-coded
 * at the call site. Under the emulators, GCLOUD_PROJECT is set by
 * `firebase emulators:exec`; in production Cloud Functions it is ambient.
 */
import * as path from 'node:path'

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) return fallback
  if (parsed < min || parsed > max) return fallback
  return parsed
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return fallback
}

/** Separate prefixes: API routes mount under /api/v1 (rule 7). */
export const API_PREFIX = '/api/v1'

export const config = {
  /** GCP/Firebase project id; emulators inject a deterministic one. */
  projectId: process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? 'stack12-demo',
  /** Emulator host:ports, overridable for parallel CI runs. */
  authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099',
  firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088',
  /** Login throttle: fixed window keyed by email + peer IP. */
  throttle: {
    loginMaxAttempts: envInt('LOGIN_THROTTLE_MAX_ATTEMPTS', 5, 1, 100),
    loginWindowMs: envInt('LOGIN_THROTTLE_WINDOW_MS', 60_000, 1_000, 3_600_000),
    loginRetryAfterSeconds: envInt('LOGIN_THROTTLE_RETRY_AFTER_SECONDS', 60, 1, 3_600),
  },
  /** Payload bounds (defense in depth; enforced at route level too). */
  bounds: {
    maxEmailLength: 254,
    maxPasswordLength: 128,
    maxTitleLength: 200,
    maxContentLength: 10_000,
    maxAlgorithmInputLength: 10_000,
  },
  /** Session cookie lifetime (idle); sliding on each /home hit. */
  sessionTtlMinutes: envInt('SESSION_TTL_MINUTES', 30, 5, 1440),
  /** Secure cookies only behind TLS (rule: local dev stays plain). */
  secureCookies: envBool('SECURE_COOKIES', false),
  /** CORS allowlist for the Angular dev/preview servers. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:4200,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== ''),
} as const

export type AppConfig = typeof config

/** Firestore collections. */
export const COLLECTIONS = {
  users: 'users',
  sessions: 'sessions',
  documents: 'documents',
  algorithmRuns: 'algorithmRuns',
} as const

export const STACK_ROOT = path.resolve(__dirname, '..')
