/**
 * Response envelope helpers — Stack 18 wire contract.
 *
 * Every JSON response is wrapped exactly like:
 *
 *   { "ok": true,  "data": {...}, "error": null,   "requestId": "<id>" }
 *   { "ok": false, "data": null,  "error": {...},  "requestId": "<id>" }
 *
 * `requestId` is the *validated* client-supplied X-Request-Id (or a freshly
 * generated opaque id) — the same id is echoed in the X-Request-Id response
 * header (Stack-20 lesson: never echo it unvalidated).
 *
 * Error shape is stable: { code, message, details? } — never a stack trace,
 * SQL fragment, or internal infrastructure name.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { randomBytes } from 'node:crypto'
import * as errorCodes from './error-codes.js'

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes]

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

/**
 * Resolves the request id for a request: the client-supplied X-Request-Id
 * header when it matches the safe pattern, otherwise a fresh opaque 32-hex
 * id. Invalid values (too long, spaces, control characters — header
 * injection / log-forging vectors) are never echoed.
 */
export function resolveRequestId(headers: Record<string, unknown>): string {
  const raw = headers['x-request-id']
  if (typeof raw === 'string' && REQUEST_ID_PATTERN.test(raw)) return raw
  return randomBytes(16).toString('hex')
}

/** Express middleware: pins the resolved requestId on `res.locals`. */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  res.locals.requestId = resolveRequestId(req.headers)
  res.setHeader('X-Request-Id', res.locals.requestId as string)
  next()
}

/** Reads the request id pinned by {@link requestIdMiddleware}. */
export function requestIdOf(res: Response): string {
  const id = res.locals.requestId
  return typeof id === 'string' && id.length > 0 ? id : 'n/a'
}

/** Wraps the envelope contract into Express so handlers stay declarative. */
function sendEnvelope<T>(res: Response, ok: boolean, data: T | null, error: EnvelopeError | null, status: number): void {
  const body: EnvelopeBody<T> = { ok, data, error, requestId: requestIdOf(res) }
  res.status(status)
  res.json(body)
}

/** Success envelope (HTTP 200 unless a different status is passed). */
export function envelopeOk<T>(res: Response, data: T, status = 200): void {
  sendEnvelope(res, true, data, null, status)
}

/** Error envelope with a stable code and safe message. */
export function envelopeError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: FieldDetail[],
): void {
  sendEnvelope(res, false, null, { code, message, ...(details ? { details } : {}) }, status)
}

/**
 * Last-resort error boundary: anything uncaught becomes a generic 500
 * INTERNAL_ERROR envelope. Stack traces and internals never reach clients.
 */
export function errorBoundary(_err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return
  }
  envelopeError(res, 500, errorCodes.INTERNAL_ERROR, 'An unexpected error occurred. Please try again.')
}

export interface ValidationErrorEntry {
  field: string
  code: string
}

/** Convenience: a 400 VALIDATION_ERROR envelope with field-level details. */
export function validationError(res: Response, details: ValidationErrorEntry[], message = 'The request contains invalid fields.'): void {
  envelopeError(res, 400, errorCodes.VALIDATION_ERROR, message, details)
}
