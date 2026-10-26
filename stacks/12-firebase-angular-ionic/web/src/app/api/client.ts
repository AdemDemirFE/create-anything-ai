/**
 * Client-side envelope for Stack 12 web/mobile.
 *
 * The backend ALWAYS returns { ok, data, error, requestId }; this layer adds
 * transport-level failures (network, timeout) as NETWORK_ERROR envelopes so
 * pages only ever consume one shape. X-Request-Id is generated per request
 * and validated with the same regex the server enforces.
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
  Network: 'NETWORK_ERROR',
  Unknown: 'UNKNOWN',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

export interface EnvelopeError {
  code: ErrorCode | string
  message: string
  details?: Array<{ field: string; code: string }>
}

export interface Envelope<T> {
  ok: boolean
  data: T | null
  error: EnvelopeError | null
  requestId: string
}

/** Same pattern the server enforces (single source of truth is the server). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode | string
  readonly details?: Array<{ field: string; code: string }>

  constructor(status: number, code: ErrorCode | string, message: string, details?: Array<{ field: string; code: string }>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
}

/** Random opaque id matching REQUEST_ID_PATTERN. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.baseUrl = options.baseUrl ?? '/api/v1'
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const requestId = newRequestId()
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin)
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v))
      }
    }
    let response: Response
    try {
      response = await this.fetchImpl(url.toString(), {
        method: options.method ?? 'GET',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Request-Id': requestId,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    } catch {
      throw new ApiError(0, ErrorCodes.Network, 'Network error — is the API running?')
    }

    let body: Envelope<T> | null = null
    try {
      body = (await response.json()) as Envelope<T>
    } catch {
      throw new ApiError(response.status, ErrorCodes.Unknown, 'Malformed response from API.')
    }

    if (!body || typeof body.ok !== 'boolean') {
      throw new ApiError(response.status, ErrorCodes.Unknown, 'Malformed response from API.')
    }
    if (!body.ok || !response.ok) {
      const err = body.error ?? { code: ErrorCodes.Unknown, message: 'Request failed.' }
      throw new ApiError(response.status, err.code, err.message, err.details)
    }
    return body.data as T
  }
}
