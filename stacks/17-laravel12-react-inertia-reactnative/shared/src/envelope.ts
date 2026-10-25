/**
 * Stack 17 shared envelope contract — the SINGLE normalizer used by BOTH
 * clients: the React (Inertia) web app and the React Native thin shell.
 *
 * Server responses on /api/v1 are always:
 *
 *   { "ok": true,  "data": {...}, "error": null,   "requestId": "..." }
 *   { "ok": false, "data": null,  "error": {...},  "requestId": "..." }
 *
 * `normalizeEnvelope` turns any raw HTTP outcome (parsed JSON, non-JSON
 * garbage, missing body) into either a validated Envelope or a synthesized
 * NETWORK_ERROR envelope, so neither client can drift apart on error
 * handling. This mirrors Stack 18's shared-layer lesson: put the wire
 * contract in one tested Node module and keep the platform shells thin.
 */

export interface EnvelopeErrorDetails {
  field: string
  code: string
}

export interface EnvelopeError {
  code: string
  message: string
  details?: EnvelopeErrorDetails[]
}

export interface Envelope<T = unknown> {
  ok: boolean
  data: T | null
  error: EnvelopeError | null
  requestId: string
}

/** Error thrown for every non-ok envelope or failed request. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string
  readonly details?: EnvelopeErrorDetails[]

  constructor(
    code: string,
    message: string,
    status: number,
    requestId: string,
    details?: EnvelopeErrorDetails[],
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
    this.details = details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Opaque fallback id used when the transport produced nothing usable. */
export const SYNTHETIC_REQUEST_ID = 'n/a'

/**
 * Normalizes a parsed response body into a validated envelope.
 * Returns null when the body is not an envelope-shaped object at all —
 * the caller decides how to surface that (usually NETWORK_ERROR).
 */
export function parseEnvelope(raw: unknown): Envelope | null {
  if (!isRecord(raw)) return null
  if (typeof raw.ok !== 'boolean') return null
  if (typeof raw.requestId !== 'string' || raw.requestId.length === 0) return null

  let error: EnvelopeError | null = null
  if (raw.error !== null && raw.error !== undefined) {
    if (!isRecord(raw.error) || typeof raw.error.code !== 'string' || typeof raw.error.message !== 'string') {
      return null
    }
    error = {
      code: raw.error.code,
      message: raw.error.message,
      ...(Array.isArray(raw.error.details)
        ? {
            details: raw.error.details.filter(
              (detail): detail is EnvelopeErrorDetails =>
                isRecord(detail) && typeof detail.field === 'string' && typeof detail.code === 'string',
            ),
          }
        : {}),
    }
  }

  return {
    ok: raw.ok,
    data: (raw.data ?? null) as unknown,
    error,
    requestId: raw.requestId,
  }
}

/**
 * Full transport-level normalization: non-JSON bodies and missing bodies
 * become a NETWORK_ERROR envelope instead of leaking internals to the UI
 * layer. The X-Request-Id response header is preferred as the correlation
 * id when the body itself was unreadable.
 */
export function normalizeEnvelope(raw: unknown, _status: number, requestIdHeader?: string | null): Envelope {
  const envelope = parseEnvelope(raw)
  if (envelope) return envelope
  return {
    ok: false,
    data: null,
    error: {
      code: 'NETWORK_ERROR',
      message: 'The service returned an unreadable response. Please try again.',
    },
    requestId: requestIdHeader ?? SYNTHETIC_REQUEST_ID,
  }
}

/** Builds the ApiError for a normalized envelope (ok=false). */
export function apiErrorFromEnvelope(envelope: Envelope, status: number): ApiError {
  const error = envelope.error ?? { code: 'UNKNOWN', message: 'Request failed.' }
  return new ApiError(error.code, error.message, status, envelope.requestId, error.details)
}

/** Transport-agnostic fetch signature (web fetch, Expo fetch, test mocks). */
export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<ResponseLike>

export interface ResponseLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text?(): Promise<string>
}
