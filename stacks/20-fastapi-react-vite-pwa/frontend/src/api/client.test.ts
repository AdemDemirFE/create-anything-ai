import { describe, expect, it, vi, beforeEach } from 'vitest'
import { api, ApiError } from './client'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

describe('api client envelope handling', () => {
  it('returns data on a successful envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { email: 'user@example.com' },
        error: null,
        meta: { timestamp: '2026-01-01T00:00:00Z', request_id: 'r1' },
      }),
    )

    const envelope = await api.login('user@example.com', 'CorrectHorse1')
    expect(envelope.success).toBe(true)
    expect(envelope.data?.email).toBe('user@example.com')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/login',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })

  it('throws ApiError with stable code on error envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          data: null,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
          meta: { timestamp: '2026-01-01T00:00:00Z', request_id: 'r2' },
        },
        400,
      ),
    )

    const promise = api.login('a@b.co', 'wrong')
    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 400,
    })
    await expect(promise).rejects.toBeInstanceOf(ApiError)
  })

  it('surfaces 429 RATE_LIMITED with its status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          data: null,
          error: { code: 'RATE_LIMITED', message: 'Too many failed login attempts. Try again later.' },
          meta: { timestamp: 't', request_id: 'r' },
        },
        429,
      ),
    )

    await expect(api.login('a@b.co', 'wrong')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    })
  })

  it('synthesizes NETWORK_ERROR when the body is not JSON (offline case)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('no json') } })

    await expect(api.home()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('sends bounded algorithm run payloads', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { algorithmId: 'fizzbuzz', output: '1', executionMs: 0.3, complexity: 'O(n)', explanation: 'x' },
        error: null,
        meta: { timestamp: 't', request_id: 'r3', execution_ms: 0.4 },
      }),
    )

    await api.runAlgorithm('fizzbuzz', '1')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ algorithm: 'fizzbuzz', input: '1' })
  })
})
