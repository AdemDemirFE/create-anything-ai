// API client for Stack 36 — envelope-aware fetch wrapper.
// Every response follows docs/PRODUCT_REQUIREMENTS.md §7:
//   { success, data, error: {code,message,details?} | null,
//     meta: { timestamp, execution_ms?, request_id } }
// The session cookie is sent automatically (same-origin via the Vite proxy).

export interface FieldError {
  field: string
  code: string
}

export interface ApiError {
  code: string
  message: string
  details?: FieldError[]
}

export interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: ApiError | null
  meta: {
    timestamp: string
    execution_ms?: number
    request_id: string
  }
}

export class ApiRequestError extends Error {
  code: string
  details: FieldError[]
  requestId: string

  constructor(err: ApiError, requestId: string) {
    super(err.message)
    this.name = 'ApiRequestError'
    this.code = err.code
    this.details = err.details ?? []
    this.requestId = requestId
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiEnvelope<T>> {
  let resp: Response
  try {
    resp = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    // Network failure: synthesize an envelope-shaped error (never a raw throw).
    return {
      success: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'Cannot reach the server.' },
      meta: { timestamp: new Date().toISOString(), request_id: 'client-local' },
    }
  }

  let parsed: ApiEnvelope<T>
  try {
    parsed = (await resp.json()) as ApiEnvelope<T>
  } catch {
    parsed = {
      success: false,
      data: null,
      error: { code: 'BAD_RESPONSE', message: `Server returned non-JSON (HTTP ${resp.status}).` },
      meta: { timestamp: new Date().toISOString(), request_id: 'client-local' },
    }
  }
  return parsed
}

export async function apiGet<T>(path: string): Promise<ApiEnvelope<T>> {
  return request<T>('GET', path)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<ApiEnvelope<T>> {
  return request<T>('POST', path, body)
}
