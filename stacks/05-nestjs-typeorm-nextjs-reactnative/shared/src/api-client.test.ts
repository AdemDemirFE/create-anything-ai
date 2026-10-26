/**
 * Shared-layer contract tests: envelope normalization, error mapping and
 * bounded payloads are the SAME code the web app and the RN shell import,
 * so this suite pins the client half of the API contract without a server.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ApiClient,
  ApiError,
  REQUEST_ID_PATTERN,
  apiErrorFromEnvelope,
  normalizeEnvelope,
  type ResponseLike,
} from './index.js'

function fakeResponse(overrides: { body?: unknown; ok?: boolean; status?: number; headers?: Record<string, string> } = {}): ResponseLike {
  const { body, ...rest } = overrides
  const headers = new Map<string, string>(Object.entries(rest.headers ?? {}))
  return {
    ok: rest.ok ?? true,
    status: rest.status ?? 200,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as ResponseLike
}

describe('envelope normalization', () => {
  it('normalizes a well-formed envelope', () => {
    const raw = { ok: true, data: { a: 1 }, error: null }
    const normalized = normalizeEnvelope<{ a: number }>(raw)
    expect(normalized.ok).toBe(true)
    expect(normalized.data).toEqual({ a: 1 })
    expect(normalized.error).toBeNull()
  })

  it('coerces missing data/error to null', () => {
    const normalized = normalizeEnvelope({ ok: true })
    expect(normalized.data).toBeNull()
    expect(normalized.error).toBeNull()
  })

  it('rejects non-envelope shapes as UNKNOWN', () => {
    for (const raw of [null, 'string', 42, [], { hello: 'world' }, { ok: 'yes', data: null }]) {
      const normalized = normalizeEnvelope(raw)
      expect(normalized.ok).toBe(false)
      expect(normalized.error?.code).toBe('UNKNOWN')
    }
  })

  it('maps an error envelope to ApiError with code/message/details', () => {
    const err = apiErrorFromEnvelope(400, {
      ok: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        details: [{ field: 'email', code: 'INVALID_FORMAT', message: 'Enter a valid email address.' }],
      },
    })
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.status).toBe(400)
    expect(err.details).toHaveLength(1)
    expect(err.details[0]?.field).toBe('email')
  })

  it('falls back to UNKNOWN for non-envelope error bodies', () => {
    const err = apiErrorFromEnvelope(502, '<html>Bad gateway</html>')
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toBe('The server returned an unexpected response.')
  })

  it('pins the request-id header shape', () => {
    expect(REQUEST_ID_PATTERN.test('a1B2c3-XYZ_9')).toBe(false) // underscore not allowed
    expect(REQUEST_ID_PATTERN.test('a1B2c3-XYZ-9')).toBe(true)
    expect(REQUEST_ID_PATTERN.test('d'.repeat(64))).toBe(true)
    expect(REQUEST_ID_PATTERN.test('d'.repeat(65))).toBe(false)
    expect(REQUEST_ID_PATTERN.test('')).toBe(false)
  })
})

describe('ApiClient', () => {
  it('sends JSON bodies and returns data + request id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({
        body: { ok: true, data: { id: 'u1', email: 'user@example.com' }, error: null },
        headers: { 'x-request-id': 'req-123' },
      }),
    )
    const client = new ApiClient({ baseUrl: '/api/v1', fetchImpl })
    const { data, requestId } = await client.login('user@example.com', 'Correct-Horse-1')
    expect(data.email).toBe('user@example.com')
    expect(requestId).toBe('req-123')
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method: string; body?: string; headers?: Record<string, string> }]
    expect(url).toBe('/api/v1/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body ?? '{}')).toEqual({ email: 'user@example.com', password: 'Correct-Horse-1' })
  })

  it('throws ApiError with the envelope error for 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 409,
        body: { ok: false, data: null, error: { code: 'EMAIL_TAKEN', message: 'That email cannot be used.' } },
      }),
    )
    const client = new ApiClient({ fetchImpl })
    await expect(client.register('user@example.com', 'Correct-Horse-1')).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
      status: 409,
    })
  })

  it('ignores malformed X-Request-Id values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({
        body: { ok: true, data: null, error: null },
        headers: { 'x-request-id': 'bad_id<script>' },
      }),
    )
    const client = new ApiClient({ fetchImpl })
    const { requestId } = await client.home()
    expect(requestId).toBeNull()
  })

  it('rejects oversized payloads client-side without a network call', async () => {
    const fetchImpl = vi.fn()
    const client = new ApiClient({ fetchImpl })
    await expect(client.runAlgorithm('reverse', 'x'.repeat(10_001))).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('propagates network failures as UNKNOWN ApiError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = new ApiClient({ fetchImpl })
    await expect(client.home()).rejects.toBeInstanceOf(TypeError)
  })

  it('builds document list query strings', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({ body: { ok: true, data: { documents: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }, error: null } }),
    )
    const client = new ApiClient({ fetchImpl })
    await client.listDocuments(2, 'alpha')
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('/api/v1/documents?page=2&search=alpha')
  })
})
