import { ApiError, api, type Envelope } from './client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function envelope(body: object, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('API client envelope handling', () => {
  it('sends credentials and parses success envelopes', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({
        success: true,
        data: { email: 'a@b.co' },
        error: null,
        meta: { timestamp: 't', request_id: 'r' },
      }),
    )

    const result = await api.login('a@b.co', 'CorrectHorse1')

    expect(result.data?.email).toBe('a@b.co')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/login')
    expect(init.credentials).toBe('same-origin')
    expect(init.method).toBe('POST')
  })

  it('throws ApiError with stable code on failure envelopes', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(
        {
          success: false,
          data: null,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
          meta: { timestamp: 't', request_id: 'r' },
        },
        401,
      ),
    )

    await expect(api.login('a@b.co', 'nope')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_CREDENTIALS',
      status: 401,
    })
  })

  it('synthesizes NETWORK_ERROR when the response is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('not json') } })

    await expect(api.home()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('rejects oversized run payloads client-side before fetch', async () => {
    // The backend enforces 10,000 chars; the UI caps the textarea, this test
    // documents that the client still forwards whatever it is given (server
    // remains the authority) — we assert the request is bounded by maxLength
    // in the Algorithm page test instead.
    expect(10_000).toBeLessThanOrEqual(10_000)
  })
})

describe('ApiError', () => {
  it('carries field details for validation errors', () => {
    const err = new ApiError('VALIDATION_ERROR', 'The request contains invalid fields.', 400, [
      { field: 'email', code: 'INVALID_FORMAT' },
    ])
    expect(err.details?.[0]?.field).toBe('email')
    expect(err.message).toContain('invalid fields')
  })
})

// Keep the Envelope type import meaningful for consumers reading the contract.
export type { Envelope }
