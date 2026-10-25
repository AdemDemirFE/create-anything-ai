/**
 * Stack 17 shared API client — used by BOTH the React (Inertia) web app and
 * the React Native (Expo) thin shell.
 *
 * Transport-agnostic: callers inject their `fetch` implementation (browser
 * fetch on web, Expo/React Native fetch on mobile, mocks in tests), so the
 * request building, envelope normalization, and error surfacing live in
 * exactly one place.
 *
 * Bounded payloads: the client refuses to serialize absurd inputs before
 * they ever reach the network (mirrors the server's documented bounds).
 */
import {
  ApiError,
  apiErrorFromEnvelope,
  normalizeEnvelope,
  type Envelope,
  type FetchLike,
  type ResponseLike,
} from './envelope.js'

export const MAX_NOTE_TITLE_LENGTH = 120
export const MAX_NOTE_BODY_LENGTH = 5_000
export const MAX_ALGORITHM_INPUT_LENGTH = 10_000
export const MAX_PASSWORD_LENGTH = 128
export const MAX_EMAIL_LENGTH = 254

export interface PublicUser {
  id: number
  name: string
  email: string
}

export interface HomeData {
  user: PublicUser
  metrics: Array<{ label: string; value: string | number }>
  serverTime: string
}

export interface AlgorithmInfo {
  id: string
  label: string
  complexity: string
  explanation: string
}

export interface AlgorithmCatalog {
  algorithms: AlgorithmInfo[]
  maxInputLength: number
}

export interface AlgorithmRunResult {
  algorithm: string
  input_preview: string
  output: string
  execution_ms: number
  complexity: string
  explanation: string
}

export interface NoteDto {
  id: number
  title: string
  body: string | null
  created_at?: string
  updated_at?: string
}

/** Pagination metadata returned by the bounded notes list (review follow-up). */
export interface NotesPageData {
  notes: NoteDto[]
  page: number
  limit: number
  total: number
  hasMore: boolean
}

/** Server-side list bounds (config/stack.php, tightened only). */
export const NOTES_DEFAULT_LIMIT = 50
export const NOTES_MAX_LIMIT = 100

export interface ApiClientOptions {
  /** Base URL, e.g. '/api/v1' (web same-origin) or 'http://host/api/v1' (mobile). */
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
  async register(name: string, email: string, password: string): Promise<Envelope<{ user: PublicUser }>> {
    assertBounded('Email', email, MAX_EMAIL_LENGTH)
    assertBounded('Password', password, MAX_PASSWORD_LENGTH)
    return this.request('/register', { method: 'POST', body: JSON.stringify({ name, email, password }) })
  }

  async login(email: string, password: string): Promise<Envelope<{ user: PublicUser }>> {
    assertBounded('Email', email, MAX_EMAIL_LENGTH)
    assertBounded('Password', password, MAX_PASSWORD_LENGTH)
    return this.request('/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  }

  logout(): Promise<Envelope<{ logged_out: boolean }>> {
    return this.request('/logout', { method: 'POST', body: JSON.stringify({}) })
  }

  me(): Promise<Envelope<{ user: PublicUser }>> {
    return this.request('/me')
  }

  // --- home ----------------------------------------------------------------
  home(): Promise<Envelope<HomeData>> {
    return this.request('/home')
  }

  // --- notes CRUD ------------------------------------------------------------
  /**
   * Bounded notes list: `?limit=` (1..NOTES_MAX_LIMIT, clamped server-side)
   * and `?page=` (>= 1). Response carries page/limit/total/hasMore so the
   * RN shell can drive "load more" without guessing. Oversized/invalid
   * values are refused CLIENT-side (bounded payloads) and clamped
   * SERVER-side (tighten-only contract).
   */
  async listNotes(options: { page?: number; limit?: number } = {}): Promise<Envelope<NotesPageData>> {
    const params = new URLSearchParams()
    if (options.page !== undefined) {
      if (!Number.isInteger(options.page) || options.page < 1) {
        throw new ApiError('VALIDATION_ERROR', 'page must be an integer >= 1.', 0, 'client')
      }
      params.set('page', String(options.page))
    }
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new ApiError('VALIDATION_ERROR', 'limit must be an integer >= 1.', 0, 'client')
      }
      if (options.limit > NOTES_MAX_LIMIT) {
        throw new ApiError('INPUT_TOO_LARGE', `limit exceeds the maximum of ${NOTES_MAX_LIMIT}.`, 0, 'client')
      }
      params.set('limit', String(options.limit))
    }
    const query = params.toString()
    return this.request(`/notes${query ? `?${query}` : ''}`)
  }

  getNote(id: number | string): Promise<Envelope<{ note: NoteDto }>> {
    return this.request(`/notes/${encodeURIComponent(String(id))}`)
  }

  async createNote(title: string, body: string | null = null): Promise<Envelope<{ note: NoteDto }>> {
    assertBounded('Title', title, MAX_NOTE_TITLE_LENGTH)
    if (body !== null) assertBounded('Body', body, MAX_NOTE_BODY_LENGTH)
    return this.request('/notes', { method: 'POST', body: JSON.stringify({ title, body }) })
  }

  async updateNote(
    id: number | string,
    patch: { title: string; body: string | null },
  ): Promise<Envelope<{ note: NoteDto }>> {
    assertBounded('Title', patch.title, MAX_NOTE_TITLE_LENGTH)
    if (patch.body !== null) assertBounded('Body', patch.body, MAX_NOTE_BODY_LENGTH)
    return this.request(`/notes/${encodeURIComponent(String(id))}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    })
  }

  deleteNote(id: number | string): Promise<Envelope<{ deleted: boolean }>> {
    return this.request(`/notes/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
  }

  // --- algorithm workbench ---------------------------------------------------
  algorithms(): Promise<Envelope<AlgorithmCatalog>> {
    return this.request('/algorithm')
  }

  async runAlgorithm(algorithmId: string, input: string): Promise<Envelope<AlgorithmRunResult>> {
    assertBounded('Input', input, MAX_ALGORITHM_INPUT_LENGTH)
    return this.request('/algorithm/run', { method: 'POST', body: JSON.stringify({ algorithmId, input }) })
  }
}
