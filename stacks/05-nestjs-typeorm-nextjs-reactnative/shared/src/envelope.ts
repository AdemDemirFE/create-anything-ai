/**
 * Stack 05 API envelope — the single response contract shared by the
 * NestJS server, the Next.js web client and the React Native shell.
 *
 * Contract (docs/PRODUCT_REQUIREMENTS.md §7 + task rules):
 *   { ok: true|false, data: <payload|null>, error: {code,message,details?}|null }
 *   plus the X-Request-Id response header ([A-Za-z0-9-]{1,64}).
 */
export interface ErrorDetail {
  field: string
  code: string
  message: string
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: ErrorDetail[]
}

export interface Envelope<T = unknown> {
  ok: boolean
  data: T | null
  error: ApiErrorBody | null
}

export const REQUEST_ID_HEADER = 'x-request-id'
/** Opaque correlation id — pin the allowed shape ([A-Za-z0-9-]{1,64}). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

export type FetchLike = (url: string, init?: unknown) => Promise<ResponseLike>

export interface ResponseLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

/** Raised for every non-2xx (or malformed) response; safe for UI display. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: ErrorDetail[]

  constructor(code: string, message: string, status: number, details: ErrorDetail[] = []) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function apiErrorFromEnvelope(status: number, body: unknown): ApiError {
  if (body !== null && typeof body === 'object') {
    const candidate = body as Partial<Envelope<unknown>>
    if (candidate.error && typeof candidate.error === 'object' && typeof candidate.error.code === 'string') {
      return new ApiError(
        candidate.error.code,
        typeof candidate.error.message === 'string' ? candidate.error.message : 'Request failed.',
        status,
        Array.isArray(candidate.error.details) ? candidate.error.details : [],
      )
    }
  }
  return new ApiError('UNKNOWN', 'The server returned an unexpected response.', status)
}

/**
 * Envelope hardening: anything that is not a well-formed envelope shape is
 * surfaced as UNKNOWN rather than trusted. The 419 lesson from stack 16:
 * never let a proxy/error page leak through as data.
 */
export function normalizeEnvelope<T>(raw: unknown): Envelope<T> {
  if (raw !== null && typeof raw === 'object') {
    const candidate = raw as Partial<Envelope<T>>
    if (typeof candidate.ok === 'boolean') {
      return {
        ok: candidate.ok,
        data: (candidate.data ?? null) as T | null,
        error: (candidate.error ?? null) as ApiErrorBody | null,
      }
    }
  }
  return { ok: false, data: null, error: { code: 'UNKNOWN', message: 'Malformed response envelope.' } }
}
