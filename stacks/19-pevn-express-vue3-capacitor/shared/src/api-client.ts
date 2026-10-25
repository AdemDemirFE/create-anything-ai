/**
 * Stack 19 shared API client — used by BOTH the Vue 3 web app and the
 * Capacitor mobile shell.
 *
 * Transport-agnostic: callers inject their `fetch` implementation (browser
 * fetch on web, the webview/native fetch inside Capacitor on mobile), so the
 * request building, envelope normalization, and error surfacing live in
 * exactly one place.
 *
 * Bounded payloads: the client refuses to serialize absurd inputs before
 * they ever reach the network (mirrors the server's documented bounds).
 */
import { ApiError, apiErrorFromEnvelope, normalizeEnvelope, type Envelope, type FetchLike, type ResponseLike } from './envelope.js'

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
  /** Base URL of the server, e.g. '/api/v1' (web proxy) or 'http://10.0.2.2:4000/api/v1' (mobile). */
  baseUrl?: string
  /** Fetch implementation; defaults to the platform global fetch. */
  fetchImpl?: FetchLike
}

function assertBounded(name: string, value: string, max: number): void {
  if (value.length > max) {
    throw new ApiError('INPUT_TOO_LARGE', `${name} exceeds the maximum length of ${max} characters.`, 0, 'client')
  }
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api/v1'
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit))
  }

  private async request<T>(path: string, init: Record<string, unknown> = {}): Promise<Envelope<T>> {
    let response: ResponseLike
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...init,
      })
    } catch {
      // Transport-level failure (offline, DNS, CORS block): a safe
      // envelope-shaped error instead of a raw exception.
      throw new ApiError('NETWORK_ERROR', 'The service is unreachable. Please try again.', 0, 'n/a')
    }

    let raw: unknown = null
    try {
      raw = await response.json()
    } catch {
      raw = null // non-JSON body → normalizeEnvelope synthesizes NETWORK_ERROR
    }

    const envelope = normalizeEnvelope(raw, response.status, response.headers.get('X-Request-Id'))
    if (!envelope.ok || !response.ok) {
      throw apiErrorFromEnvelope(envelope, response.status)
    }
    return envelope as Envelope<T>
  }

  // --- auth ----------------------------------------------------------------
  async register(email: string, password: string): Promise<Envelope<{ user: PublicUser }>> {
    assertBounded('Email', email, MAX_EMAIL_LENGTH)
    assertBounded('Password', password, MAX_PASSWORD_LENGTH)
    return this.request('/register', { method: 'POST', body: JSON.stringify({ email, password }) })
  }

  async login(email: string, password: string): Promise<Envelope<{ user: PublicUser }>> {
    assertBounded('Email', email, MAX_EMAIL_LENGTH)
    assertBounded('Password', password, MAX_PASSWORD_LENGTH)
    return this.request('/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  }

  logout(): Promise<Envelope<null>> {
    return this.request('/logout', { method: 'POST' })
  }

  // --- home ----------------------------------------------------------------
  home(): Promise<Envelope<HomeData>> {
    return this.request('/home')
  }

  // --- algorithm workbench ---------------------------------------------------
  algorithms(): Promise<Envelope<AlgorithmInfo[]>> {
    return this.request('/algorithm')
  }

  async runAlgorithm(algorithm: string, input: string): Promise<Envelope<AlgorithmRunResult>> {
    assertBounded('Input', input, MAX_ALGORITHM_INPUT_LENGTH)
    return this.request('/algorithm/run', { method: 'POST', body: JSON.stringify({ algorithm, input }) })
  }

  // --- documents CRUD ---------------------------------------------------------
  listDocuments(page = 1, limit = 20): Promise<Envelope<DocumentListData>> {
    return this.request(`/documents?page=${page}&limit=${limit}`)
  }

  getDocument(id: string): Promise<Envelope<{ document: DocumentDto }>> {
    return this.request(`/documents/${encodeURIComponent(id)}`)
  }

  async createDocument(title: string, content: string, tags: string[] = []): Promise<Envelope<{ document: DocumentDto }>> {
    assertBounded('Title', title, MAX_TITLE_LENGTH)
    assertBounded('Content', content, MAX_CONTENT_LENGTH)
    return this.request('/documents', { method: 'POST', body: JSON.stringify({ title, content, tags }) })
  }

  async updateDocument(id: string, patch: { title?: string; content?: string; tags?: string[] }): Promise<Envelope<{ document: DocumentDto }>> {
    if (patch.title !== undefined) assertBounded('Title', patch.title, MAX_TITLE_LENGTH)
    if (patch.content !== undefined) assertBounded('Content', patch.content, MAX_CONTENT_LENGTH)
    return this.request(`/documents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) })
  }

  deleteDocument(id: string): Promise<Envelope<{ deletedId: string }>> {
    return this.request(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}
