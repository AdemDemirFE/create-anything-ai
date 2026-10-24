/**
 * API client for Stack 01. Envelope-compatible with the backend contract
 * (docs/PRODUCT_REQUIREMENTS.md section 7).
 */

export interface EnvelopeMeta {
  timestamp: string
  execution_ms?: number | null
  request_id: string
}

export interface EnvelopeError {
  code: string
  message: string
  details?: Array<{ field: string; code: string }>
}

export interface Envelope<T> {
  success: boolean
  data: T | null
  error: EnvelopeError | null
  meta: EnvelopeMeta
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: Array<{ field: string; code: string }>

  constructor(code: string, message: string, status: number, details?: Array<{ field: string; code: string }>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

const API_BASE = '/api/v1'

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  // Double-submit CSRF: echo the XSRF-TOKEN cookie on state-changing calls.
  // The backend re-issues the cookie on every response, so the value is
  // always current. register/login are CSRF-exempt server-side, but sending
  // the header unconditionally is harmless and simpler.
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const token = readCookie('XSRF-TOKEN')
    if (token) headers['X-XSRF-TOKEN'] = token
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers,
    ...init,
  })

  let body: Envelope<T>
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    // Non-JSON failure (proxy/network): synthesize a safe envelope-shaped error.
    body = {
      success: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'The service is unreachable. Please try again.' },
      meta: { timestamp: new Date().toISOString(), request_id: 'n/a' },
    }
  }

  if (!response.ok || !body.success) {
    const err = body.error ?? { code: 'UNKNOWN', message: 'Request failed.' }
    throw new ApiError(err.code, err.message, response.status, err.details)
  }
  return body
}

export interface AuthUser {
  email: string
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthUser>('/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<AuthUser>('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => request<null>('/logout', { method: 'POST' }),

  me: () => request<AuthUser>('/me'),

  home: () =>
    request<{
      email: string
      demo: boolean
      metrics: Array<{ label: string; value: string; unit: string }>
      serverTime: string
    }>('/home'),

  algorithms: () =>
    request<
      Array<{ id: string; name: string; complexity: string; explanation: string }>
    >('/algorithm'),

  runAlgorithm: (algorithm: string, input: string) =>
    request<{
      algorithmId: string
      output: string
      executionMs: number
      complexity: string
      explanation: string
    }>('/algorithm/run', { method: 'POST', body: JSON.stringify({ algorithm, input }) }),
}
