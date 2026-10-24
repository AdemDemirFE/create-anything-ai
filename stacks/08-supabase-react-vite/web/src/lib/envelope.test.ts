/**
 * Envelope normalization tests — the stack's §7-equivalent contract.
 * These run against the pure mapping helpers (no network, no client).
 */

import {
  ErrorCodes,
  failureEnvelope,
  friendlyMessage,
  generateRequestId,
  mapAuthErrorCode,
  mapPostgrestErrorCode,
  successEnvelope,
} from './envelope'

describe('auth error-code mapping', () => {
  it('maps GoTrue invalid_credentials / user_not_found to INVALID_CREDENTIALS', () => {
    expect(mapAuthErrorCode('invalid_credentials')).toBe(ErrorCodes.InvalidCredentials)
    expect(mapAuthErrorCode('user_not_found')).toBe(ErrorCodes.InvalidCredentials)
    expect(mapAuthErrorCode('email_not_confirmed')).toBe(ErrorCodes.InvalidCredentials)
  })

  it('maps email_exists to EMAIL_TAKEN and weak_password to WEAK_PASSWORD', () => {
    expect(mapAuthErrorCode('email_exists')).toBe(ErrorCodes.EmailTaken)
    expect(mapAuthErrorCode('weak_password')).toBe(ErrorCodes.WeakPassword)
  })

  it('maps rate-limit codes to RATE_LIMITED', () => {
    expect(mapAuthErrorCode('over_request_rate_limit')).toBe(ErrorCodes.RateLimited)
    expect(mapAuthErrorCode('over_email_send_rate_limit')).toBe(ErrorCodes.RateLimited)
  })

  it('maps unknown provider codes to UNKNOWN (never leaks internals)', () => {
    expect(mapAuthErrorCode('some_future_code')).toBe(ErrorCodes.Unknown)
    expect(mapAuthErrorCode(undefined)).toBe(ErrorCodes.Unknown)
  })
})

describe('postgrest error-code mapping', () => {
  it('maps PGRST116 to NOT_FOUND and 23505 to CONFLICT', () => {
    expect(mapPostgrestErrorCode('PGRST116', 406)).toBe(ErrorCodes.NotFound)
    expect(mapPostgrestErrorCode('23505', 409)).toBe(ErrorCodes.Conflict)
  })

  it('maps the RLS denial (42501 / 403) to FORBIDDEN', () => {
    expect(mapPostgrestErrorCode('42501', 403)).toBe(ErrorCodes.Forbidden)
    expect(mapPostgrestErrorCode(undefined, 403)).toBe(ErrorCodes.Forbidden)
    expect(mapPostgrestErrorCode(undefined, 401)).toBe(ErrorCodes.Forbidden)
  })

  it('maps transport failures (5xx) to NETWORK_ERROR', () => {
    expect(mapPostgrestErrorCode(undefined, 502)).toBe(ErrorCodes.Network)
    expect(mapPostgrestErrorCode(undefined, 500)).toBe(ErrorCodes.Network)
  })

  it('keeps unknown statuses UNKNOWN', () => {
    expect(mapPostgrestErrorCode('weird', 418)).toBe(ErrorCodes.Unknown)
  })
})

describe('envelope shapes', () => {
  it('success envelope has ok=true, error=null, and a requestId', () => {
    const envelope = successEnvelope({ hello: 'world' }, 'req-1')
    expect(envelope).toEqual({ ok: true, data: { hello: 'world' }, error: null, requestId: 'req-1' })
  })

  it('failure envelope carries data=null and the error triple', () => {
    const envelope = failureEnvelope({ code: ErrorCodes.Forbidden, message: 'nope', status: 403 }, 'req-2')
    expect(envelope.ok).toBe(false)
    expect(envelope.data).toBeNull()
    expect(envelope.error?.code).toBe('FORBIDDEN')
    expect(envelope.error?.status).toBe(403)
    expect(envelope.requestId).toBe('req-2')
  })

  it('generates unique requestIds when the provider provides none', () => {
    const a = generateRequestId()
    const b = generateRequestId()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(8)
  })
})

describe('friendly messages', () => {
  it('maps stable codes to user-safe copy', () => {
    expect(friendlyMessage(ErrorCodes.InvalidCredentials)).toMatch(/invalid email or password/i)
    expect(friendlyMessage(ErrorCodes.RateLimited)).toMatch(/too many requests/i)
  })

  it('never echoes provider internals', () => {
    const message = friendlyMessage('pgrst_internal_explosion_42')
    expect(message).toMatch(/something went wrong/i)
    expect(message).not.toMatch(/pgrst/i)
  })
})
