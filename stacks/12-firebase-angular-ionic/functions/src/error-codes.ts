/**
 * Stable error codes for Stack 12 wire contract.
 *
 * The client layer maps Firebase Auth internal codes to these before any
 * envelope crosses the wire; provider-internal strings (auth/..., permission
 * denied, etc.) never leak to a caller.
 */
export const ErrorCodes = {
  Validation: 'VALIDATION_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  EmailTaken: 'EMAIL_TAKEN',
  WeakPassword: 'WEAK_PASSWORD',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  InputTooLarge: 'INPUT_TOO_LARGE',
  RateLimited: 'RATE_LIMITED',
  Unavailable: 'UNAVAILABLE',
  Unknown: 'UNKNOWN',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]
