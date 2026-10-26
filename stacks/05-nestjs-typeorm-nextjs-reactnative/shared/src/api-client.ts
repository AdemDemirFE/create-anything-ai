/**
 * Stack 05 shared API client — used by BOTH the Next.js web app and the
 * React Native (Expo) shell.
 *
 * Transport-agnostic: callers inject their `fetch` implementation (browser/
 * Next.js fetch on web, Expo/React Native fetch on mobile), so request
 * building, envelope normalization and error surfacing live in exactly one
 * place. Bounded payloads: the client refuses to serialize absurd inputs
 * before they ever reach the network (mirrors the server's documented
 * bounds).
 */
import {
  ApiError,
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
  apiErrorFromEnvelope,
  normalizeEnvelope,
  type Envelope,
  type FetchLike,
} from './envelope.js'

export const MAX_TITLE_LENGTH = 200
export const MAX_CONTENT_LENGTH = 10_000
export const MAX_ALGORITHM_INPUT_LENGTH = 10_000
export const MAX_PASSWORD_LENGTH = 128
export const MAX_EMAIL_LENGTH = 254

export interface PublicUser {
  id: string
  email: string
}

export interface HomeData {
  email: string
  metrics: Array<{ label: string; value: string; unit: string }>
  serverTime: string
}

export interface AlgorithmInfo {
  id: string
  name: string
  complexity: string
  explanation: string
}

export interface AlgorithmRunResult {
  algorithmId: string
  output: string
  executionMs: number
  complexity: string
  explanation: string
}

export interface DocumentDto {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface DocumentListData {
  documents: DocumentDto[]
  pagination: { page: number; limit: number; total: number; pages: number }
}

export interface ApiClientOptions {
  /** Base URL of the server, e.g. '/api/v1' (web proxy) or 'https://host/api/v1' (mobile). */
  baseUrl?: string
  /** Fetch implementation; defaults to the platform global fetch. */
  fetchImpl?: FetchLike
  /** Cookie/credentials mode; 'include' for cross-origin mobile calls. */
  credentials?: 'omit' | 'same-origin' | 'include'
}

function assertBounded(name: string, value: string, max: number): void {
  if (value.length > max) {
    throw new ApiError('INPUT_TOO_LARGE', `${name} exceeds the maximum length of ${max} characters.`, 0)
  }
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike
  private readonly credentials: 'omit' | 'same-origin' | 'include'

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api/v1'
    this.fetchImpl =
      options.fetchImpl ??
      ((url, init) => fetch(url, init as RequestInit))
    this.credentials = options.credentials ?? 'same-origin'
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ data: T; requestId: string | null }> {
    if (body !== undefined) {
      assertBounded('Request payload', JSON.stringify(body), MAX_CONTENT_LENGTH + MAX_TITLE_LENGTH)
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: this.credentials,
    })

    // Correlation id: header shape is contract-tested; anything else is
    // treated as absent rather than echoed to logs/UI.
    const headerValue = response.headers.get(REQUEST_ID_HEADER)
    const requestId = headerValue !== null && REQUEST_ID_PATTERN.test(headerValue) ? headerValue : null

    let raw: unknown = null
    try {
      const text = await response.text()
      raw = text === '' ? null : JSON.parse(text)
    } catch {
      throw apiErrorFromEnvelope(response.status, null)
    }

    if (!response.ok) {
      throw apiErrorFromEnvelope(response.status, raw)
    }

    const envelope = normalizeEnvelope<T>(raw)
    if (!envelope.ok) {
      throw apiErrorFromEnvelope(response.status, raw)
    }
    return { data: envelope.data as T, requestId }
  }

  register(email: string, password: string): Promise<{ data: PublicUser; requestId: string | null }> {
    try {
      assertBounded('Email', email, MAX_EMAIL_LENGTH)
      assertBounded('Password', password, MAX_PASSWORD_LENGTH)
    } catch (err) {
      return Promise.reject(err)
    }
    return this.request<PublicUser>('POST', '/auth/register', { email, password })
  }

  login(email: string, password: string): Promise<{ data: PublicUser; requestId: string | null }> {
    try {
      assertBounded('Email', email, MAX_EMAIL_LENGTH)
      assertBounded('Password', password, MAX_PASSWORD_LENGTH)
    } catch (err) {
      return Promise.reject(err)
    }
    return this.request<PublicUser>('POST', '/auth/login', { email, password })
  }

  logout(): Promise<{ data: null; requestId: string | null }> {
    return this.request<null>('POST', '/auth/logout')
  }

  home(): Promise<{ data: HomeData; requestId: string | null }> {
    return this.request<HomeData>('GET', '/home')
  }

  algorithms(): Promise<{ data: { algorithms: AlgorithmInfo[]; maxInputLength: number }; requestId: string | null }> {
    return this.request<{ algorithms: AlgorithmInfo[]; maxInputLength: number }>('GET', '/algorithm')
  }

  runAlgorithm(algorithmId: string, input: string): Promise<{ data: AlgorithmRunResult; requestId: string | null }> {
    try {
      assertBounded('Algorithm input', input, MAX_ALGORITHM_INPUT_LENGTH)
    } catch (err) {
      return Promise.reject(err)
    }
    return this.request<AlgorithmRunResult>('POST', '/algorithm/run', { algorithmId, input })
  }

  listDocuments(page = 1, search = ''): Promise<{ data: DocumentListData; requestId: string | null }> {
    const params = new URLSearchParams({ page: String(page) })
    if (search !== '') params.set('search', search)
    return this.request<DocumentListData>('GET', `/documents?${params.toString()}`)
  }

  getDocument(id: string): Promise<{ data: DocumentDto; requestId: string | null }> {
    return this.request<DocumentDto>('GET', `/documents/${encodeURIComponent(id)}`)
  }

  createDocument(title: string, content: string, tags: string[] = []): Promise<{ data: DocumentDto; requestId: string | null }> {
    try {
      assertBounded('Title', title, MAX_TITLE_LENGTH)
      assertBounded('Content', content, MAX_CONTENT_LENGTH)
    } catch (err) {
      return Promise.reject(err)
    }
    return this.request<DocumentDto>('POST', '/documents', { title, content, tags })
  }

  updateDocument(id: string, patch: Partial<Pick<DocumentDto, 'title' | 'content' | 'tags'>>): Promise<{ data: DocumentDto; requestId: string | null }> {
    if (patch.title !== undefined) assertBounded('Title', patch.title, MAX_TITLE_LENGTH)
    if (patch.content !== undefined) assertBounded('Content', patch.content, MAX_CONTENT_LENGTH)
    return this.request<DocumentDto>('PATCH', `/documents/${encodeURIComponent(id)}`, patch)
  }

  deleteDocument(id: string): Promise<{ data: null; requestId: string | null }> {
    return this.request<null>('DELETE', `/documents/${encodeURIComponent(id)}`)
  }
}
