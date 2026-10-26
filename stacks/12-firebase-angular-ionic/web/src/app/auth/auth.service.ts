/**
 * Auth state + API calls for the Angular app.
 *
 * Session model: HttpOnly cookie (server-issued opaque token); the browser
 * never sees the Firebase ID token. isAuthenticated is optimistic (cookie
 * presence cannot be read — HttpOnly) so /home 401s re-sync it.
 */
import { Injectable, signal } from '@angular/core'
import { ApiClient, ApiError } from '../api/client'

export interface PublicUser {
  uid: string
  email: string
  displayName: string | null
}

export interface HomeData {
  user: { email: string; displayName: string | null }
  metrics: Array<{ label: string; value: string; unit: string }>
  serverTime: string
}

export interface DocumentDto {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface DocumentListData {
  documents: DocumentDto[]
  pagination: { page: number; limit: number; total: number; pages: number }
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
  durationMs: number
  complexity: string
  explanation: string
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = new ApiClient({ baseUrl: this.apiBaseUrl() })
  readonly user = signal<PublicUser | null>(null)

  private apiBaseUrl(): string {
    // Web uses its OWN base (separate prefixes rule 7): in dev the Angular
    // proxy forwards /api/v1; production sets the Functions URL.
    return (globalThis as { __STACK12_API__?: string }).__STACK12_API__ ?? '/api/v1'
  }

  get client(): ApiClient {
    return this.api
  }

  async register(email: string, password: string, displayName?: string): Promise<PublicUser> {
    const data = await this.api.request<{ user: PublicUser }>('/auth/register', {
      method: 'POST',
      body: { email, password, displayName },
    })
    return data.user
  }

  async login(email: string, password: string): Promise<PublicUser> {
    const data = await this.api.request<{ user: PublicUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    this.user.set(data.user)
    return data.user
  }

  async logout(): Promise<void> {
    try {
      await this.api.request<null>('/auth/logout', { method: 'POST' })
    } finally {
      this.user.set(null)
    }
  }

  /** Backend re-check (PRD §6 Home): 401 clears the optimistic state. */
  async loadHome(): Promise<HomeData> {
    try {
      const data = await this.api.request<HomeData>('/home')
      // The /home payload user has no uid (server never sends it there) —
      // refresh the known fields of the existing auth state instead of
      // assigning a uid-less object into PublicUser.
      this.user.update((u) => (u ? { ...u, email: data.user.email, displayName: data.user.displayName } : u))
      return data
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.user.set(null)
      throw err
    }
  }
}
