// client.test.ts — envelope handling of the API client (jsdom fetch mock).
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { apiGet, apiPost, ApiRequestError } from './client'

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('api client envelope handling', () => {
  it('returns the parsed envelope on success', async () => {
    const envelope = {
      success: true,
      data: { email: 'a@b.co' },
      error: null,
      meta: { timestamp: 't', request_id: 'r1' },
    }
    mockFetchOnce(200, envelope)
    const got = await apiGet<{ email: string }>('/api/v1/me')
    expect(got.success).toBe(true)
    expect(got.data?.email).toBe('a@b.co')
  })

  it('surfaces a stable error envelope on failure', async () => {
    const envelope = {
      success: false,
      data: null,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      meta: { timestamp: 't', request_id: 'r2' },
    }
    mockFetchOnce(401, envelope)
    const got = await apiPost('/api/v1/login', { email: 'x', password: 'y' })
    expect(got.success).toBe(false)
    expect(got.error?.code).toBe('INVALID_CREDENTIALS')
    expect(got.data).toBeNull()
  })

  it('synthesizes a NETWORK_ERROR envelope when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    const got = await apiGet('/api/v1/home')
    expect(got.success).toBe(false)
    expect(got.error?.code).toBe('NETWORK_ERROR')
    expect(got.data).toBeNull()
  })

  it('synthesizes BAD_RESPONSE for non-JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError('not json')),
      } as unknown as Response),
    )
    const got = await apiGet('/api/v1/home')
    expect(got.error?.code).toBe('BAD_RESPONSE')
  })

  it('sends JSON body with content-type on POST', async () => {
    const fetchMock = mockFetchOnce(201, {
      success: true,
      data: { email: 'a@b.co' },
      error: null,
      meta: { timestamp: 't', request_id: 'r3' },
    })
    await apiPost('/api/v1/register', { email: 'a@b.co', password: 'pw12345678' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/register')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.credentials).toBe('same-origin')
  })
})

describe('ApiRequestError', () => {
  it('carries code, message and details', () => {
    const err = new ApiRequestError(
      {
        code: 'VALIDATION_ERROR',
        message: 'bad',
        details: [{ field: 'email', code: 'INVALID_FORMAT' }],
      },
      'rid',
    )
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toHaveLength(1)
    expect(err.requestId).toBe('rid')
  })
})
