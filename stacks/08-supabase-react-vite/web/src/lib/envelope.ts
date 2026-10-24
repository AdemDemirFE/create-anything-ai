/**
 * Envelope + error model for stack 08.
 *
 * PRD §7 defines the wire envelope produced by a custom backend. In the BaaS
 * paradigm of this stack there IS no custom backend: supabase-js returns its
 * own `{data, error}` pairs (auth) and PostgREST errors (`{message, code,
 * details, hint}`). The data layer in dataApi.ts / authApi.ts normalizes all
 * of that into the stable client-side envelope required by this stack:
 *
 *   { ok: boolean, data: T | null, error: EnvelopeError | null, requestId: string }
 *
 * The envelope is the ONLY shape pages consume, so a future switch of
 * provider touches this layer alone.
 */

/** Stable error codes produced by this layer (never provider internals). */
export const ErrorCodes = {
  Validation: 'VALIDATION_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  EmailTaken: 'EMAIL_TAKEN',
  WeakPassword: 'WEAK_PASSWORD',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  RateLimited: 'RATE_LIMITED',
  Network: 'NETWORK_ERROR',
  Unknown: 'UNKNOWN',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

export interface EnvelopeError {
  code: ErrorCode | string
  message: string
  /** HTTP-ish status when one is available (0 = no transport status). */
  status: number
}

export interface Envelope<T> {
  ok: boolean
  data: T | null
  error: EnvelopeError | null
  /** Correlation id for this call — provider meta when available, else generated. */
  requestId: string
}

/** Map an AuthApiError-style `code` (GoTrue error codes) to a stable code. */
export function mapAuthErrorCode(code: string | undefined): ErrorCode {
  switch (code) {
    case 'invalid_credentials':
    case 'user_not_found':
    case 'email_not_confirmed':
    case 'bad_jwt':
    case 'session_not_found':
      return ErrorCodes.InvalidCredentials
    case 'email_exists':
    case 'user_already_exists':
      return ErrorCodes.EmailTaken
    case 'weak_password':
      return ErrorCodes.WeakPassword
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return ErrorCodes.RateLimited
    case 'validation_failed':
      return ErrorCodes.Validation
    default:
      return ErrorCodes.Unknown
  }
}

/**
 * Map a PostgREST error to a stable code. RLS denial reaches the client as
 * PostgreSQL 42501 wrapped by PostgREST (403), not as a specific PGRST code —
 * both map to FORBIDDEN here.
 */
export function mapPostgrestErrorCode(code: string | undefined, status: number): ErrorCode {
  switch (code) {
    case 'PGRST116':
      return ErrorCodes.NotFound
    case '23505':
      return ErrorCodes.Conflict
    case '23514':
    case '22P02':
    case '23503':
      return ErrorCodes.Validation
    case '42501':
      return ErrorCodes.Forbidden
    default:
      break
  }
  if (status === 401 || status === 403) return ErrorCodes.Forbidden
  if (status === 404) return ErrorCodes.NotFound
  if (status === 409) return ErrorCodes.Conflict
  if (status === 429) return ErrorCodes.RateLimited
  if (status === 413) return ErrorCodes.Validation
  if (status >= 500) return ErrorCodes.Network
  return ErrorCodes.Unknown
}

const FRIENDLY: Record<string, string> = {
  [ErrorCodes.InvalidCredentials]: 'Invalid email or password.',
  [ErrorCodes.EmailTaken]: 'An account with this email already exists.',
  [ErrorCodes.WeakPassword]: 'This password is too weak. Use 8+ characters with letters and numbers.',
  [ErrorCodes.Forbidden]: 'You do not have access to this resource.',
  [ErrorCodes.NotFound]: 'The requested item does not exist (or is not yours).',
  [ErrorCodes.Conflict]: 'That value conflicts with an existing one.',
  [ErrorCodes.RateLimited]: 'Too many requests. Please wait a moment and try again.',
  [ErrorCodes.Network]: 'The service is unreachable. Please try again.',
  [ErrorCodes.Validation]: 'The submitted values are invalid.',
  [ErrorCodes.Unknown]: 'Something went wrong. Please try again.',
}

/** Never leak provider internals to users: friendly text per stable code. */
export function friendlyMessage(code: string): string {
  return FRIENDLY[code] ?? FRIENDLY[ErrorCodes.Unknown]
}

let requestCounter = 0

/** Fallback correlation id when the provider response carries none. */
export function generateRequestId(): string {
  requestCounter += 1
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${cryptoObj.randomUUID()}-${requestCounter}`
  }
  return `req-${Date.now()}-${requestCounter}`
}

export function failureEnvelope(error: EnvelopeError, requestId?: string): Envelope<never> {
  return { ok: false, data: null, error, requestId: requestId ?? generateRequestId() }
}

export function successEnvelope<T>(data: T, requestId: string): Envelope<T> {
  return { ok: true, data, error: null, requestId }
}
