/**
 * GlobalExceptionFilter — the single place any error becomes an HTTP
 * response. Everything leaves as the contract envelope with a stable code
 * and a SAFE message; internal errors never leak stack traces, SQL text or
 * infrastructure names (PRD §7; stack-16 419 lesson).
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { TypeORMError } from 'typeorm'
import { Response } from 'express'
import { ApiError } from './api-error.js'
import { REQUEST_ID_HEADER } from './envelope.interceptor.js'
import { newRequestId } from './envelope-types.js'
import { ERROR_CODES } from './error-codes.js'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code: string = ERROR_CODES.INTERNAL
    let message = 'Something went wrong. Please try again.'
    let details: Array<{ field: string; code: string; message: string }> = []
    let retryAfterSeconds: number | undefined

    if (exception instanceof ApiError) {
      status = exception.getStatus()
      code = exception.code
      message = exception.message
      details = exception.details
      retryAfterSeconds = exception.retryAfterSeconds
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'object' && body !== null) {
        const shaped = body as { code?: unknown; message?: unknown; details?: unknown; error?: unknown }
        // NestJS ValidationPipe shape: { statusCode, message: string|string[], error }
        const rawMessages = (shaped.message ?? shaped.error) as unknown
        if (typeof rawMessages === 'string') {
          code = ERROR_CODES.VALIDATION_ERROR
          message = rawMessages
        } else if (Array.isArray(rawMessages)) {
          code = ERROR_CODES.VALIDATION_ERROR
          message = 'The request contains invalid fields.'
          details = rawMessages
            .filter((m): m is string => typeof m === 'string')
            .map((m) => ({ field: m, code: 'INVALID', message: m }))
        } else if (typeof shaped.code === 'string' && typeof shaped.message === 'string') {
          code = shaped.code
          message = shaped.message
        } else {
          message = 'Request failed.'
        }
      } else {
        message = 'Request failed.'
      }
    } else if (exception instanceof TypeORMError) {
      // Database errors: log server-side, return a safe generic message.
      this.logger.error(`database error: ${exception.message}`)
      code = ERROR_CODES.INTERNAL
      message = 'Something went wrong. Please try again.'
    } else {
      this.logger.error(
        `unhandled error: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
      )
    }

    const payload = {
      ok: false,
      data: null,
      error: { code, message, ...(details.length > 0 ? { details } : {}) },
    }

    if (retryAfterSeconds !== undefined) {
      response.setHeader('retry-after', String(Math.max(1, Math.ceil(retryAfterSeconds))))
    }
    if (!response.getHeader(REQUEST_ID_HEADER)) {
      // Error paths that short-circuit before the interceptor still get a
      // correlation id on the response.
      response.setHeader(REQUEST_ID_HEADER, newRequestId())
    }
    response.status(status).json(payload)
  }
}
