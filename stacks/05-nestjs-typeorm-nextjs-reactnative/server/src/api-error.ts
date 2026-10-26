/**
 * ApiError — the ONLY exception shape that crosses the HTTP boundary.
 * The global exception filter maps every error to the envelope with a
 * stable code, a safe message and (for validation) field details.
 */
import { HttpException } from '@nestjs/common'
import type { ErrorDetail } from './envelope-types.js'

export class ApiError extends HttpException {
  readonly code: string
  readonly details: ErrorDetail[]
  readonly retryAfterSeconds?: number

  constructor(code: string, message: string, status: number, details: ErrorDetail[] = [], retryAfterSeconds?: number) {
    super({ code, message, details }, status)
    this.name = 'ApiError'
    this.code = code
    this.details = details
    this.retryAfterSeconds = retryAfterSeconds
  }
}
