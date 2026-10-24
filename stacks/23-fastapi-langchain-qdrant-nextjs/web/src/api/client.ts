/**
 * API client for Stack 23. Envelope-compatible with the backend contract
 * (docs/PRODUCT_REQUIREMENTS.md section 7).
 *
 * Chat is plain request/response JSON - there is deliberately no SSE or
 * streaming consumption anywhere in this client (QA lesson M9): the UI
 * polls by issuing normal POST requests per question.
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

async function request<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  }
  if (init.body && typeof init.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      headers,
      ...init,
    })
  } catch {
    // Transport-level failure (proxy/network/offline): synthesize the same
    // safe envelope-shaped error as a non-JSON body would get.
    throw new ApiError('NETWORK_ERROR', 'The service is unreachable. Please try again.', 0)
  }

  let body: Envelope<T>
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    // Non-JSON failure (proxy/network/offline): synthesize a safe envelope-
    // shaped error instead of leaking raw transport details to the UI.
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

export interface HomeData {
  email: string
  metrics: Array<{ label: string; value: string; unit: string }>
  serverTime: string
}

export interface DocumentInfo {
  documentId: string
  filename: string
  sizeBytes: number
  chunkCount: number
  createdAt: string
}

export interface ChatSource {
  documentId: string
  filename: string
  chunkIndex: number
  score: number
  snippet: string
}

export interface ChatAnswer {
  question: string
  answer: string
  sources: ChatSource[]
  executionMs: number
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthUser>('/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<AuthUser>('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => request<null>('/logout', { method: 'POST' }),

  me: () => request<AuthUser>('/me'),

  home: () => request<HomeData>('/home'),

  documents: () => request<DocumentInfo[]>('/documents'),

  uploadDocument: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<DocumentInfo>('/documents', { method: 'POST', body: form })
  },

  // Plain JSON POST per question (polling model; no EventSource/fetch-stream).
  chat: (question: string) =>
    request<ChatAnswer>('/chat', { method: 'POST', body: JSON.stringify({ question }) }),
}
