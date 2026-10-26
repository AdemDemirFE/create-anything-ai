/**
 * Response envelope helpers — Stack 12 wire contract.
 *
 * Every JSON response is wrapped exactly like:
 *
 *   { "ok": true,  "data": {...}, "error": null,  "requestId": "<id>" }
 *   { "ok": false, "data": null,  "error": {...}, "requestId": "<id>" }
 *
 * `requestId` is the *validated* client-supplied X-Request-Id (or a freshly
 * generated opaque id) — the same id is echoed in the X-Request-Id response
 * header. A client-supplied id is honored ONLY when it matches
 * ^[A-Za-z0-9-]{1,64}$; anything else is replaced (Stack-19/20 lesson: never
 * echo unvalidated client strings into headers or bodies).
 *
 * Error shape is stable: { code, message, details? } — never a stack trace,
 * provider-internal code, or infrastructure name.
 */
import { randomBytes } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import * as codes from './error-codes.js'

export type ErrorCode = codes.ErrorCode

export interface FieldDetail {
  field: string
  code: string
}

export interface EnvelopeError {
  code: ErrorCode
  message: string
  details?: FieldDetail[]
}

export interface EnvelopeBody<T> {
  ok: boolean
  data: T | null
  error: EnvelopeError | null
  requestId: string
}

/** X-Request-Id must match this pattern; anything else is discarded. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

/** Error thrown by routes; the handler converts it to the error envelope. */
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: FieldDetail[]

  constructor(status: number, code: ErrorCode, message: string, details?: FieldDetail[]) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Generate a fresh opaque request id (32 hex chars). */
export function freshRequestId(): string {
  return randomBytes(16).toString('hex')
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string
  }
}

/**
 * Resolve + attach the request id and echo it in the response header.
 * Invalid client ids are never echoed.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const supplied = req.header('X-Request-Id')
  const valid = typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied)
  req.requestId = valid ? supplied : freshRequestId()
  res.setHeader('X-Request-Id', req.requestId)
  next()
}

export function envelopeOk<T>(res: Response, data: T, requestId: string, headers?: Record<string, string>): void {
  if (headers) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  }
  const body: EnvelopeBody<T> = { ok: true, data, error: null, requestId }
  res.status(200).json(body)
}

/**
 * Central error envelope. Must be registered LAST (Express error handler,
 * arity 4). Unknown errors collapse to UNKNOWN with a generic message so
 * internals never leak.
 */
export function envelopeErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? freshRequestId()
  if (!res.headersSent) res.setHeader('X-Request-Id', requestId)
  if (res.headersSent) {
    // Nothing sane left to send; drop the connection-side error.
    return
  }
  if (err instanceof ApiError) {
    const body: EnvelopeBody<null> = {
      ok: false,
      data: null,
      error: err.details ? { code: err.code, message: err.message, details: err.details } : { code: err.code, message: err.message },
      requestId,
    }
    res.status(err.status).json(body)
    return
  }
  const body: EnvelopeBody<null> = {
    ok: false,
    data: null,
    error: { code: codes.ErrorCodes.Unknown, message: 'Unexpected server error.' },
    requestId,
  }
  res.status(500).json(body)
}

/** 404 inside the API prefix, wrapped in the envelope. */
export function envelopeNotFound(req: Request, res: Response): void {
  const requestId = req.requestId ?? freshRequestId()
  res.setHeader('X-Request-Id', requestId)
  const body: EnvelopeBody<null> = {
    ok: false,
    data: null,
    error: { code: codes.ErrorCodes.NotFound, message: 'Route not found.' },
    requestId,
  }
  res.status(404).json(body)
}
