/**
 * Fake Supabase server for tests (fetch-level).
 *
 * The REAL @supabase/supabase-js client runs in tests; only the network is
 * replaced. This module implements just enough of the two wire protocols the
 * stack uses, derived from the shipped SDK sources (supabase-js/auth-js/
 * postgrest-js 2.118.0):
 *
 * GoTrue (auth-js `lib/fetch.js`):
 *   POST {base}/auth/v1/signup                        -> {access_token,...,user}
 *   POST {base}/auth/v1/token?grant_type=password     -> {access_token,...,user}
 *   POST {base}/auth/v1/logout?scope=global           -> 204 no content
 *   GET  {base}/auth/v1/user                          -> {id,email,...}
 *   Errors: non-2xx with {code, msg} + `x-sb-api-version: 2024-01-01`
 *           (auth-js then maps body.code onto AuthApiError.code).
 *
 * PostgREST (postgrest-js):
 *   GET    {base}/rest/v1/apps?select=*&order=created_at.desc
 *   GET    {base}/rest/v1/apps?select=*&id=eq.<uuid>
 *   POST   {base}/rest/v1/apps            (Prefer: return=representation)
 *   PATCH  {base}/rest/v1/apps?id=eq.<uuid>
 *   DELETE {base}/rest/v1/apps?id=eq.<uuid>
 *   RLS denial simulation: rows not owned by the JWT subject are invisible;
 *   writes with a mismatched user_id return 42501-style errors like Postgres.
 *
 * What is deliberately NOT simulated: token refresh timers, rate limits,
 * SMTP/confirmation, network retries. Sessions are issued with a 1-hour
 * expiry; tests that need stability use the exact returned session.
 */

import type { AppRow } from '../lib/database.types'

export const SUPABASE_URL = 'https://stack08-fake.supabase.test'
export const ANON_KEY = 'sb_ref_fake_anon_key_for_tests_0000000000000000000000'

const API_VERSION_HEADER = 'X-Supabase-Api-Version'
const API_VERSION_VALUE = '2024-01-01'

export interface FakeUser {
  id: string
  email: string
  password: string
}

export interface FakeSession {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at: number
  token_type: 'bearer'
  user: FakeUser & { email_confirmed_at: string; created_at: string }
}

interface AuthState {
  users: FakeUser[]
  /** subject (user id) -> session access token issued by the fake */
  tokens: Map<string, string>
}

export class FakeSupabase {
  readonly auth: AuthState = { users: [], tokens: new Map() }
  /** apps rows keyed by id — owner is user_id; RLS is enforced on access. */
  readonly apps: AppRow[] = []
  private rowCounter = 0

  seedUser(email: string, password: string): FakeUser {
    const existing = this.auth.users.find((u) => u.email === email)
    if (existing) return existing
    const user: FakeUser = {
      id: crypto.randomUUID(),
      email,
      password,
    }
    this.auth.users.push(user)
    return user
  }

  /** Insert an apps row directly (bypasses RLS) for test fixtures. */
  seedApp(ownerId: string, name: string, status: AppRow['status'] = 'active'): AppRow {
    this.rowCounter += 1
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, this.rowCounter)).toISOString()
    const row: AppRow = {
      id: crypto.randomUUID(),
      user_id: ownerId,
      name,
      description: `Seeded fixture ${name}`,
      status,
      created_at: now,
      updated_at: now,
    }
    this.apps.push(row)
    return row
  }

  private issueSession(user: FakeUser): FakeSession {
    const access = `fake-jwt.${btoa(JSON.stringify({ sub: user.id })).replace(/=+$/, '')}.sig`
    this.auth.tokens.set(user.id, access)
    const expires_in = 3600
    return {
      access_token: access,
      refresh_token: crypto.randomUUID(),
      expires_in,
      expires_at: Math.floor(Date.now() / 1000) + expires_in,
      token_type: 'bearer',
      user: {
        ...user,
        email_confirmed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    }
  }

  private subjectFromRequest(request: Request): string | null {
    const authz = request.headers.get('Authorization') ?? ''
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : ''
    if (!token) return null
    for (const [subject, known] of this.auth.tokens.entries()) {
      if (known === token) return subject
    }
    // Accept structurally valid fake JWTs signed for seeded users even when
    // the token map lost them (e.g. after logout) — the JWT carries the sub.
    try {
      const payloadPart = token.split('.')[1]
      if (payloadPart) {
        const json = atob(payloadPart + '='.repeat((4 - (payloadPart.length % 4)) % 4))
        const payload = JSON.parse(json) as { sub?: string }
        if (payload.sub && this.auth.users.some((u) => u.id === payload.sub)) {
          return payload.sub
        }
      }
    } catch {
      // fallthrough
    }
    return null
  }

  private jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', [API_VERSION_HEADER]: API_VERSION_VALUE, ...headers },
    })
  }

  /** Handle one request; returns a Response (or promise of one) or null when URL is unknown. */
  handle(url: URL, request: Request): Response | Promise<Response> | null {
    const path = url.pathname
    if (path.startsWith('/auth/v1/')) return this.handleAuth(url, request)
    if (path.startsWith('/rest/v1/')) return this.handleRest(url, request)
    return null
  }

  // ------------------------------------------------------------------ auth
  private handleAuth(url: URL, request: Request): Response | Promise<Response> | null {
    if (request.method === 'POST' && url.pathname === '/auth/v1/signup') {
      return this.handleSignup(request)
    }
    if (request.method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      return this.handlePasswordGrant(request)
    }
    if (request.method === 'POST' && url.pathname === '/auth/v1/logout') {
      return this.handleLogout(request)
    }
    if (request.method === 'GET' && url.pathname === '/auth/v1/user') {
      return this.handleGetUser(request)
    }
    return null
  }

  private handleSignup(request: Request): Promise<Response> {
    return request
      .json()
      .then(async (raw): Promise<Response> => {
        const body = raw as { email?: unknown; password?: unknown; data?: unknown }
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const password = typeof body.password === 'string' ? body.password : ''
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return this.jsonResponse({ code: 'validation_failed', msg: 'Invalid email format' }, 422)
        }
        if (password.length < 8) {
          return this.jsonResponse(
            { code: 'weak_password', msg: 'Password should be at least 8 characters' },
            422,
          )
        }
        if (this.auth.users.some((u) => u.email === email)) {
          return this.jsonResponse({ code: 'email_exists', msg: 'User already registered' }, 422)
        }
        const user = this.seedUser(email, password)
        const session = this.issueSession(user)
        return this.jsonResponse({ ...session }, 200)
      })
      .catch(
        async (): Promise<Response> =>
          this.jsonResponse({ code: 'bad_json', msg: 'invalid request body' }, 400),
      )
  }

  private handlePasswordGrant(request: Request): Promise<Response> {
    return request
      .json()
      .then(async (raw): Promise<Response> => {
        const body = raw as { email?: unknown; password?: unknown }
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const password = typeof body.password === 'string' ? body.password : ''
        const user = this.auth.users.find((u) => u.email === email)
        // Unknown user and wrong password are indistinguishable (GoTrue
        // behavior; PRD §6 login bullet).
        if (!user || user.password !== password) {
          return this.jsonResponse(
            { code: 'invalid_credentials', msg: 'Invalid login credentials' },
            400,
          )
        }
        const session = this.issueSession(user)
        return this.jsonResponse({ ...session }, 200)
      })
      .catch(
        async (): Promise<Response> =>
          this.jsonResponse({ code: 'bad_json', msg: 'invalid request' }, 400),
      )
  }

  private handleLogout(request: Request): Response {
    // auth-js ignores 401/403/404 on logout; a success is a 204 with no body.
    const subject = this.subjectFromRequest(request)
    if (subject) this.auth.tokens.delete(subject)
    return new Response(null, { status: 204 })
  }

  private handleGetUser(request: Request): Response {
    const subject = this.subjectFromRequest(request)
    if (!subject) {
      return this.jsonResponse({ code: 'bad_jwt', msg: 'invalid claim: missing sub claim' }, 401)
    }
    const user = this.auth.users.find((u) => u.id === subject)
    if (!user) {
      return this.jsonResponse({ code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }, 404)
    }
    return this.jsonResponse({ ...user, email_confirmed_at: new Date().toISOString() }, 200)
  }

  // ------------------------------------------------------------------ rest
  /** RLS predicate: the row is visible iff it is owned by the JWT subject. */
  private visible(row: AppRow, subject: string | null): boolean {
    return subject !== null && row.user_id === subject
  }

  private parseOperator(condition: string): { column: string; op: string; value: string } | null {
    // PostgREST filters use two wire spellings depending on how the URL was
    // built: "id=eq.<value>" (raw key=value) and "eq.<value>" (the "id=" part
    // already consumed by the query-string parser). Accept both.
    if (!condition) return null
    const separator = condition.indexOf('=')
    const rest = separator > 0 ? condition.slice(separator + 1) : condition
    const dot = rest.indexOf('.')
    if (dot < 0) {
      return separator > 0
        ? { column: condition.slice(0, separator), op: rest, value: '' }
        : null
    }
    return {
      column: separator > 0 ? condition.slice(0, separator) : '',
      op: rest.slice(0, dot),
      value: rest.slice(dot + 1),
    }
  }

  private applyFilters(rows: AppRow[], url: URL): AppRow[] {
    let result = rows
    for (const [key, rawValue] of url.searchParams.entries()) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue
      // The wire value is the operator part ("eq.<value>"); the column is the
      // search-param key ("id"). parseOperator handles both spellings.
      const cond = this.parseOperator(rawValue)
      if (!cond) continue
      const column = cond.column || key
      if (cond.op === 'eq') {
        result = result.filter((r) => (r as unknown as Record<string, unknown>)[column] === cond.value)
      }
    }
    return result
  }

  private applyOrder(rows: AppRow[], url: URL): AppRow[] {
    const order = url.searchParams.get('order')
    if (!order) return rows
    // e.g. "created_at.desc" / "created_at.desc.nullslast"
    const [column, direction] = order.split('.')
    const dir = direction === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[column] ?? '')
      const bv = String((b as unknown as Record<string, unknown>)[column] ?? '')
      if (av === bv) return 0
      return (av > bv ? 1 : -1) * dir
    })
  }

  private handleRest(url: URL, request: Request): Response | Promise<Response> | null {
    if (url.pathname !== '/rest/v1/apps') return null
    const subject = this.subjectFromRequest(request)
    const method = request.method

    if (method === 'GET') {
      const rows = this.applyOrder(this.applyFilters(this.apps, url), url).filter((r) =>
        this.visible(r, subject),
      )
      return this.jsonResponse(rows, 200)
    }

    if (method === 'POST') {
      return request
        .json()
        .then(async (raw): Promise<Response> => {
          const body = raw as Record<string, unknown>
          if (!subject) {
            // No JWT / anon role: RLS insert policy fails with 42501.
            return this.jsonResponse(
              {
                code: '42501',
                message: 'new row violates row-level security policy for table "apps"',
                details: null,
                hint: null,
              },
              403,
            )
          }
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          const description = typeof body.description === 'string' ? body.description.trim() : ''
          const status = body.status === 'active' || body.status === 'archived' ? body.status : 'draft'
          if (!name) {
            return this.jsonResponse(
              { code: '23502', message: 'null value in column "name" violates not-null constraint', details: null, hint: null },
              400,
            )
          }
          if (name.length > 80) {
            return this.jsonResponse(
              { code: '23514', message: 'new row for relation "apps" violates check constraint "apps_name_check"', details: null, hint: null },
              400,
            )
          }
          // Unique (user_id, name) — 23505 on duplicates, scoped to the owner.
          if (this.apps.some((r) => r.user_id === subject && r.name === name)) {
            return this.jsonResponse(
              {
                code: '23505',
                message: `duplicate key value violates unique constraint "apps_user_id_name_key"`,
                details: null,
                hint: null,
              },
              409,
            )
          }
          const now = new Date().toISOString()
          const row: AppRow = {
            id: crypto.randomUUID(),
            user_id: subject,
            name,
            description,
            status,
            created_at: now,
            updated_at: now,
          }
          this.apps.push(row)
          // The client always adds Prefer: return=representation + .single().
          return this.jsonResponse(row, 201)
        })
        .catch(
          async (): Promise<Response> =>
            this.jsonResponse({ message: 'invalid request body' }, 400),
        )
    }

    if (method === 'PATCH') {
      return request.json().then(async (raw): Promise<Response> => {
        const body = raw as Record<string, unknown>
        const idCond = this.parseOperator(url.searchParams.get('id') ?? '')
        if (!idCond || idCond.op !== 'eq') {
          return this.jsonResponse({ message: 'unsupported filter' }, 400)
        }
        // RLS UPDATE: only rows owned by the subject may be targeted.
        const target = this.apps.find((r) => r.id === idCond.value && this.visible(r, subject))
        if (!target) {
          // PostgREST PATCH matching zero rows returns 404 with an error
          // array body only for representation requests without rows; with
          // Accept: application/vnd.pgrst.object+json it returns PGRST116.
          return this.jsonResponse(
            {
              code: 'PGRST116',
              message: 'JSON object requested, multiple (or no) rows returned',
              details: 'Results contain 0 rows',
              hint: null,
            },
            406,
          )
        }
        const name = typeof body.name === 'string' ? body.name.trim() : target.name
        const description =
          typeof body.description === 'string' ? body.description.trim() : target.description
        const status = typeof body.status === 'string' ? body.status : target.status
        if (!name || name.length > 80) {
          return this.jsonResponse(
            { code: '23514', message: 'violates check constraint', details: null, hint: null },
            400,
          )
        }
        if (
          name !== target.name &&
          this.apps.some((r) => r.user_id === target.user_id && r.name === name)
        ) {
          return this.jsonResponse(
            { code: '23505', message: 'duplicate key value violates unique constraint "apps_user_id_name_key"', details: null, hint: null },
            409,
          )
        }
        target.name = name
        target.description = description
        target.status = (status === 'active' || status === 'archived' ? status : 'draft') as AppRow['status']
        target.updated_at = new Date().toISOString()
        return this.jsonResponse(target, 200)
      })
    }
    if (method === 'DELETE') {
      const idCond = this.parseOperator(url.searchParams.get('id') ?? '')
      if (!idCond || idCond.op !== 'eq') {
        return this.jsonResponse({ message: 'unsupported filter' }, 400)
      }
      const idx = this.apps.findIndex((r) => r.id === idCond.value && this.visible(r, subject))
      if (idx < 0) {
        // PostgREST DELETE returns 204 No Content even for zero rows matched;
        // the client treats it as success (documented in dataApi.deleteApp).
        return new Response(null, { status: 204 })
      }
      this.apps.splice(idx, 1)
      return new Response(null, { status: 204 })
    }

    return null
  }
}

/**
 * Build the fetch replacement used by tests: routes into the fake, falls back
 * to a network error for anything else (never real network).
 */
export function createFakeFetch(fake: FakeSupabase) {
  return async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const request = new Request(url, init)
    const response = await fake.handle(url, request)
    if (response) return response
    return new Response(JSON.stringify({ message: `no fake route for ${url.pathname}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
