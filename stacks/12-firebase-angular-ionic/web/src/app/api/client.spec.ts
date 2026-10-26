/**
 * Envelope client tests — the ONLY shape pages consume.
 * Uses a stubbed fetch; no network, no emulator dependency.
 */
import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError, REQUEST_ID_PATTERN, newRequestId } from './client'

function okEnvelope(data: unknown) {
  return {
    ok: true,
    data,
    error: null,
    requestId: 'resp-1',
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('request id', () => {
  it('generated ids always match the server-side pattern', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newRequestId()).toMatch(REQUEST_ID_PATTERN)
    }
  })
})

describe('ApiClient envelope handling', () => {
  it('returns data on ok envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okEnvelope({ user: { email: 'a@b.c' } })))
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    const data = await client.request<{ user: { email: string } }>('/auth/login', { method: 'POST', body: {} })
    expect(data.user.email).toBe('a@b.c')
  })

  it('sends X-Request-Id header matching the pattern', async () => {
    let captured = ''
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = String(new Headers(init?.headers).get('X-Request-Id'))
      return jsonResponse(okEnvelope(null))
    })
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.request('/health-echo')
    expect(captured).toMatch(REQUEST_ID_PATTERN)
  })

  it('throws ApiError with server code/message on error envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, data: null, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, requestId: 'r' }, 401),
    )
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.request('/auth/login', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('maps 429 + Retry-After into RATE_LIMITED ApiError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Retry later.' }, requestId: 'r' }, 429, {
        'Retry-After': '60',
      }),
    )
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    const err = await client.request('/auth/login', { method: 'POST' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(429)
    expect((err as ApiError).code).toBe('RATE_LIMITED')
  })

  it('maps transport failure to NETWORK_ERROR', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    const err = await client.request('/home').catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('NETWORK_ERROR')
  })

  it('rejects malformed (non-envelope) responses', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ hello: 'world' }))
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    const err = await client.request('/home').catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('UNKNOWN')
  })

  it('keeps query params out of the path string', async () => {
    let calledUrl = ''
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calledUrl = String(url)
      return jsonResponse(okEnvelope([]))
    })
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.request('/documents', { query: { page: 2, limit: 10, empty: undefined } })
    expect(calledUrl).toContain('page=2')
    expect(calledUrl).toContain('limit=10')
    expect(calledUrl).not.toContain('empty=')
  })
})
