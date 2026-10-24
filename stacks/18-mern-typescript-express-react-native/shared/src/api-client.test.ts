/**
 * Shared-layer tests: this is the RN-wrapper logic that CAN be verified
 * locally (no mobile SDK required) — envelope normalization and the shared
 * API client that both the web app and the Expo app consume.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiClient } from './api-client.js'
import { ApiError, normalizeEnvelope, parseEnvelope, SYNTHETIC_REQUEST_ID } from './envelope.js'
import type { ResponseLike } from './envelope.js'

function jsonResponse(body: unknown, status = 200, requestId: string | null = 'srv-1'): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-request-id' ? requestId : null) },
    json: async () => body,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
})

describe('parseEnvelope', () => {
  it('accepts a valid success envelope', () => {
    const envelope = parseEnvelope({ ok: true, data: { a: 1 }, error: null, requestId: 'r1' })
    expect(envelope).not.toBeNull()
    expect(envelope?.ok).toBe(true)
    expect(envelope?.requestId).toBe('r1')
  })

  it('accepts a valid error envelope with details', () => {
    const envelope = parseEnvelope({
      ok: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'bad', details: [{ field: 'email', code: 'REQUIRED' }, { junk: true }] },
      requestId: 'r2',
    })
    expect(envelope?.error?.code).toBe('VALIDATION_ERROR')
    expect(envelope?.error?.details).toEqual([{ field: 'email', code: 'REQUIRED' }])
  })

  it('rejects non-objects, missing ok, and missing requestId', () => {
    expect(parseEnvelope(null)).toBeNull()
    expect(parseEnvelope('text')).toBeNull()
    expect(parseEnvelope([1, 2])).toBeNull()
    expect(parseEnvelope({ data: null })).toBeNull()
    expect(parseEnvelope({ ok: true, requestId: 42 })).toBeNull()
    expect(parseEnvelope({ ok: true, requestId: '' })).toBeNull()
  })

  it('rejects malformed error objects', () => {
    expect(parseEnvelope({ ok: false, error: 'boom', requestId: 'r' })).toBeNull()
    expect(parseEnvelope({ ok: false, error: { code: 1, message: 'x' }, requestId: 'r' })).toBeNull()
  })
})

describe('normalizeEnvelope', () => {
  it('synthesizes NETWORK_ERROR for unreadable bodies', () => {
    const envelope = normalizeEnvelope('<html>bad gateway</html>', 502, 'srv-9')
    expect(envelope.ok).toBe(false)
    expect(envelope.error?.code).toBe('NETWORK_ERROR')
    expect(envelope.requestId).toBe('srv-9')
  })

  it('falls back to the synthetic id when no header exists', () => {
    const envelope = normalizeEnvelope(undefined, 0, null)
    expect(envelope.requestId).toBe(SYNTHETIC_REQUEST_ID)
  })
})

describe('ApiClient (shared by web and RN)', () => {
  it('sends credentials: same-origin and JSON headers on every call', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { user: { id: 'u1', email: 'a@b.co' } }, error: null, requestId: 'r' }, 201),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    const envelope = await client.register('a@b.co', 'correct horse battery')
    expect(envelope.data?.user.email).toBe('a@b.co')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/register')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', password: 'correct horse battery' })
  })

  it('honors a custom baseUrl (mobile deployments)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null, error: null, requestId: 'r' }))
    const client = new ApiClient({ baseUrl: 'https://api.example.com/api/v1', fetchImpl: fetchMock })
    await client.home()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/api/v1/home')
  })

  it('throws ApiError with stable code/status/requestId on error envelopes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, data: null, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, requestId: 'r-err' }, 401),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    const promise = client.login('a@b.co', 'wrong password')
    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await promise.catch((err: ApiError) => {
      expect(err.code).toBe('INVALID_CREDENTIALS')
      expect(err.status).toBe(401)
      expect(err.requestId).toBe('r-err')
    })
  })

  it('surfaces 429 RATE_LIMITED with its status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many failed login attempts. Try again later.' }, requestId: 'r' }, 429),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.login('a@b.co', 'wrong password')).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 })
  })

  it('synthesizes NETWORK_ERROR when fetch throws (offline RN case)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'))
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.home()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })

  it('synthesizes NETWORK_ERROR when the body is not JSON (bad gateway)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      headers: { get: () => null },
      json: async () => {
        throw new Error('not json')
      },
    })
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.home()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('rejects oversized payloads client-side before any network call', async () => {
    const client = new ApiClient({ fetchImpl: fetchMock })
    let caught: unknown = null
    await client.createDocument('t', 'x'.repeat(10_001)).catch((err: unknown) => {
      caught = err
    })
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('INPUT_TOO_LARGE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('encodes document ids in path segments', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { deletedId: 'a/b c' }, error: null, requestId: 'r' }),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    await client.deleteDocument('a/b c')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/documents/a%2Fb%20c')
  })

  it('sends bounded pagination on listDocuments', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { documents: [], pagination: { page: 2, limit: 50, total: 0, pages: 1 } },
        error: null,
        requestId: 'r',
      }),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    const envelope = await client.listDocuments(2, 50)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/documents?page=2&limit=50')
    expect(envelope.data?.pagination.page).toBe(2)
  })
})
