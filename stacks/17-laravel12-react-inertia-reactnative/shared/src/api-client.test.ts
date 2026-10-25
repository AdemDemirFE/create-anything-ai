/**
 * Shared-layer tests: this is the RN-thin-shell logic that CAN be verified
 * locally (no mobile SDK required) — envelope normalization and the shared
 * API client that both the React web app and the Expo app consume. The RN
 * runtime itself is NOT verified (no Expo SDK in the build environment);
 * see ../mobile/README.md and stacks/17-.../verification.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, MAX_ALGORITHM_INPUT_LENGTH, MAX_NOTE_BODY_LENGTH, MAX_NOTE_TITLE_LENGTH, NOTES_MAX_LIMIT } from './api-client.js'
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
    expect(envelope?.error).toBeNull()
    expect(envelope?.requestId).toBe('r1')
  })

  it('accepts a valid error envelope and filters malformed details', () => {
    const envelope = parseEnvelope({
      ok: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad',
        details: [{ field: 'email', code: 'INVALID' }, { junk: true }],
      },
      requestId: 'r2',
    })
    expect(envelope?.ok).toBe(false)
    expect(envelope?.error?.code).toBe('VALIDATION_ERROR')
    expect(envelope?.error?.details).toEqual([{ field: 'email', code: 'INVALID' }])
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
      jsonResponse({ ok: true, data: { user: { id: 1, name: 'Ada', email: 'a@b.co' } }, error: null, requestId: 'r' }, 201),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    const envelope = await client.register('Ada', 'a@b.co', 'correcthorse1')
    expect(envelope.data?.user.email).toBe('a@b.co')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/register')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ name: 'Ada', email: 'a@b.co', password: 'correcthorse1' })
  })

  it('honors a custom baseUrl (mobile deployments)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null, error: null, requestId: 'r' }))
    const client = new ApiClient({ baseUrl: 'http://10.0.2.2:8000/api/v1', fetchImpl: fetchMock })
    await client.home()
    expect(fetchMock.mock.calls[0][0]).toBe('http://10.0.2.2:8000/api/v1/home')
  })

  it('throws ApiError with stable code/status/requestId on error envelopes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { ok: false, data: null, error: { code: 'INVALID_CREDENTIALS', message: 'These credentials do not match our records.' }, requestId: 'r-err' },
        401,
      ),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    const promise = client.login('a@b.co', 'wrongpassword1')
    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await promise.catch((err: ApiError) => {
      expect(err.code).toBe('INVALID_CREDENTIALS')
      expect(err.status).toBe(401)
      expect(err.requestId).toBe('r-err')
    })
  })

  it('surfaces 429 RATE_LIMITED with its status and field details', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ok: false,
          data: null,
          error: { code: 'RATE_LIMITED', message: 'Too many failed login attempts. Please retry later.' },
          requestId: 'r-429',
        },
        429,
      ),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.login('a@b.co', 'wrongpassword1')).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 })
  })

  it('synthesizes NETWORK_ERROR when fetch throws (offline RN case)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'))
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.listNotes()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })

  it('treats non-JSON bodies as NETWORK_ERROR, not as a crash', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    })
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.listNotes()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('refuses oversized note payloads before any network call', async () => {
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.createNote('x'.repeat(MAX_NOTE_TITLE_LENGTH + 1))).rejects.toMatchObject({
      code: 'INPUT_TOO_LARGE',
    })
    await expect(client.createNote('ok title', 'y'.repeat(MAX_NOTE_BODY_LENGTH + 1))).rejects.toMatchObject({
      code: 'INPUT_TOO_LARGE',
    })
    await expect(client.runAlgorithm('reverse', 'z'.repeat(MAX_ALGORITHM_INPUT_LENGTH + 1))).rejects.toMatchObject({
      code: 'INPUT_TOO_LARGE',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('encodes note ids into the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { deleted: true }, error: null, requestId: 'r' }))
    const client = new ApiClient({ fetchImpl: fetchMock })
    await client.deleteNote('42')
    await client.getNote('7/evil')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/notes/42')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/notes/7%2Fevil')
  })

  it('maps notes CRUD and algorithm run onto the documented paths', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: {}, error: null, requestId: 'r' }))
    const client = new ApiClient({ fetchImpl: fetchMock })
    await client.listNotes()
    await client.createNote('T', 'B')
    await client.updateNote(3, { title: 'T2', body: null })
    await client.algorithms()
    await client.runAlgorithm('reverse', 'hello')
    await client.logout()
    const urls = fetchMock.mock.calls.map((call) => call[0])
    expect(urls).toEqual([
      '/api/v1/notes',
      '/api/v1/notes',
      '/api/v1/notes/3',
      '/api/v1/algorithm',
      '/api/v1/algorithm/run',
      '/api/v1/logout',
    ])
  })

  it('passes pagination params to the notes list and returns the page metadata', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ok: true,
          data: { notes: [{ id: 1, title: 'T', body: null }], page: 2, limit: 10, total: 11, hasMore: true },
          error: null,
          requestId: 'r',
        },
        200,
      ),
    )
    const client = new ApiClient({ fetchImpl: fetchMock })
    const envelope = await client.listNotes({ page: 2, limit: 10 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/notes?page=2&limit=10')
    expect(envelope.data?.page).toBe(2)
    expect(envelope.data?.limit).toBe(10)
    expect(envelope.data?.total).toBe(11)
    expect(envelope.data?.hasMore).toBe(true)
    expect(envelope.data?.notes).toHaveLength(1)
  })

  it('refuses invalid pagination params client-side before any network call', async () => {
    const client = new ApiClient({ fetchImpl: fetchMock })
    await expect(client.listNotes({ page: 0 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(client.listNotes({ page: 1.5 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(client.listNotes({ limit: 0 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(client.listNotes({ limit: NOTES_MAX_LIMIT + 1 })).rejects.toMatchObject({
      code: 'INPUT_TOO_LARGE',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
