/**
 * API client for Stack 02. Envelope-compatible with the backend contract
 * (docs/PRODUCT_REQUIREMENTS.md section 7):
 *
 *   { success, data, error: { code, message, details? }, meta: { timestamp, request_id } }
 *
 * The X-Request-Id of the last response is tracked so tests (and a debug
 * panel) can correlate failures. Polling is the ONLY update mechanism in
 * this stack: there is deliberately no EventSource/WebSocket code (SSE is
 * FORBIDDEN by the stack rules).
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

/** Overridable for tests; points at the backend API prefix (NOT the web prefix). */
export const API_BASE = '/api/v1'

/** Last X-Request-Id seen (correlation for support/debug). */
export let lastRequestId = '';

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

  const headerId = response.headers.get('X-Request-Id')

  let body: Envelope<T>
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    // Non-JSON failure (proxy/network): synthesize a safe envelope-shaped error.
    body = {
      success: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'The service is unreachable. Please try again.' },
      meta: { timestamp: new Date().toISOString(), request_id: headerId ?? 'n/a' },
    }
  }
  if (body.meta?.request_id) {
    lastRequestId = body.meta.request_id
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

export interface HomeData {
  user: { email: string }
  metrics: Record<string, unknown>
}

export interface CatalogEntry {
  id: string
  label: string
  complexity: string
  explanation: string
}

export interface AlgorithmResult {
  algorithmId: string
  output: string
  executionMs: number
  complexity: string
  explanation: string
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthUser>('/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<AuthUser>('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => request<{ ok: boolean }>('/logout', { method: 'POST' }),

  home: () => request<HomeData>('/home'),

  catalog: () => request<CatalogEntry[]>('/algorithm'),

  runAlgorithm: (algorithmId: string, input: string) =>
    request<AlgorithmResult>(`/algorithm?algorithm=${encodeURIComponent(algorithmId)}`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    }),
}
