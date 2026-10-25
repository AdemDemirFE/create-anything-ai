/**
 * Stack 15 — shared /api/v1 envelope contract helpers (web side).
 *
 * The envelope shape is defined in ARCHITECTURE.md and consumed by BOTH the
 * Inertia web app (for any direct fetches) and the Flutter client
 * (mobile/lib/api/api_client.dart mirrors this normalization 1:1):
 *
 *   success: { ok: true,  data: {...}, error: null,
 *              requestId: "<opaque or echoed X-Request-Id>" }
 *   failure: { ok: false, data: null,
 *              error: { code, message, details? }, requestId: "..." }
 */

export interface EnvelopeError {
    code: string;
    message: string;
    details?: Array<{ field: string; code: string }>;
}

export interface Envelope<T = unknown> {
    ok: boolean;
    data: T | null;
    error: EnvelopeError | null;
    requestId: string;
}

/** Thrown for every non-success envelope. */
export class ApiError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly status: number,
        public readonly details: EnvelopeError['details'] = [],
        public readonly requestId?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Normalizes a raw JSON body into the typed envelope.
 * Defensive: a legacy/foreign body without `ok` is treated as a failure with
 * UNKNOWN code instead of crashing the caller.
 */
export function normalizeEnvelope<T = unknown>(body: unknown): Envelope<T> {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, data: null, error: { code: 'UNKNOWN', message: 'Malformed response body.' }, requestId: '' };
    }

    const record = body as Record<string, unknown>;

    return {
        ok: record.ok === true,
        data: (record.data ?? null) as T | null,
        error: record.error === null || record.error === undefined
            ? null
            : {
                code: typeof record.error === 'object' && record.error !== null && 'code' in record.error
                    ? String((record.error as Record<string, unknown>).code)
                    : 'UNKNOWN',
                message: typeof record.error === 'object' && record.error !== null && 'message' in record.error
                    ? String((record.error as Record<string, unknown>).message)
                    : 'Request failed.',
                details: typeof record.error === 'object' && record.error !== null && 'details' in record.error
                    ? (record.error as EnvelopeError).details ?? []
                    : [],
            },
        requestId: typeof record.requestId === 'string' ? record.requestId : '',
    };
}

/** Normalizes and unwraps; throws ApiError on failure envelopes. */
export function unwrapEnvelope<T = unknown>(body: unknown): T {
    const envelope = normalizeEnvelope<T>(body);

    if (!envelope.ok) {
        throw new ApiError(
            envelope.error?.code ?? 'UNKNOWN',
            envelope.error?.message ?? 'Request failed.',
            0, // status is attached by the transport layer when available
            envelope.error?.details ?? [],
            envelope.requestId,
        );
    }

    return envelope.data as T;
}
