/**
 * Error codes returned in the `error.code` field of every failed envelope.
 * Stable, documented, never a raw exception message.
 */
export const VALIDATION_ERROR = 'VALIDATION_ERROR'
export const INVALID_CREDENTIALS = 'INVALID_CREDENTIALS'
export const EMAIL_TAKEN = 'EMAIL_TAKEN'
export const UNAUTHORIZED = 'UNAUTHORIZED'
export const RATE_LIMITED = 'RATE_LIMITED'
export const NOT_FOUND = 'NOT_FOUND'
export const INVALID_ID = 'INVALID_ID'
export const INPUT_TOO_LARGE = 'INPUT_TOO_LARGE'
export const UNKNOWN_ALGORITHM = 'UNKNOWN_ALGORITHM'
export const INVALID_INPUT = 'INVALID_INPUT'
export const INTERNAL_ERROR = 'INTERNAL_ERROR'

/** Namespace import shape used by the app factory. */
export const errorCodes = {
  VALIDATION_ERROR,
  INVALID_CREDENTIALS,
  EMAIL_TAKEN,
  UNAUTHORIZED,
  RATE_LIMITED,
  NOT_FOUND,
  INVALID_ID,
  INPUT_TOO_LARGE,
  UNKNOWN_ALGORITHM,
  INVALID_INPUT,
  INTERNAL_ERROR,
} as const
