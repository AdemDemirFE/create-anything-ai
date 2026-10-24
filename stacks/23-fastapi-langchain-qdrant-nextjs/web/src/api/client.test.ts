import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './client'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const successEnvelope = (data: unknown) => ({
  success: true,
  data,
  error: null,
  meta: { timestamp: '2026-01-01T00:00:00.000Z', request_id: 'r1' },
})

const errorEnvelope = (code: string, message: string) => ({
  success: false,
  data: null,
  error: { code, message },
  meta: { timestamp: '2026-01-01T00:00:00.000Z', request_id: 'r1' },
})

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the envelope data on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(successEnvelope({ email: 'u@b.co' })))
    const res = await api.me()
    expect(res.data).toEqual({ email: 'u@b.co' })
    expect(res.meta.request_id).toBe('r1')
  })

  it('throws ApiError with stable code on error envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(errorEnvelope('INVALID_CREDENTIALS', 'Invalid email or password.'), 401))
    await expect(api.login('u@b.co', 'bad')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_CREDENTIALS',
      status: 401,
    })
  })

  it('synthesizes a NETWORK_ERROR envelope on non-JSON transport failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network down'))
    await expect(api.me()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('maps 429 RATE_LIMITED with status for the UI', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(errorEnvelope('RATE_LIMITED', 'Too many failed login attempts.'), 429))
    const err = await api.login('u@b.co', 'x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(429)
    expect((err as ApiError).code).toBe('RATE_LIMITED')
  })

  it('chat sends a plain JSON POST (no streaming primitives)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        successEnvelope({
          question: 'q',
          answer: 'a',
          sources: [],
          executionMs: 1.2,
        }),
      ),
    )
    await api.chat('q')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/v1/chat')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBe(JSON.stringify({ question: 'q' }))
  })

  it('uploadDocument posts multipart FormData without a JSON content type', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(successEnvelope({ documentId: 'd1', filename: 'f.txt', sizeBytes: 3, chunkCount: 1, createdAt: 't' })),
    )
    const file = new File(['abc'], 'f.txt', { type: 'text/plain' })
    await api.uploadDocument(file)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect((init as RequestInit).body).toBeInstanceOf(FormData)
  })
})
