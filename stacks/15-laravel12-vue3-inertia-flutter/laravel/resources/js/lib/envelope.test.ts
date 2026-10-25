import { describe, expect, it } from 'vitest';
import { ApiError, normalizeEnvelope, unwrapEnvelope } from './envelope';

describe('normalizeEnvelope', () => {
    it('keeps the exact envelope keys on success', () => {
        const envelope = normalizeEnvelope({
            ok: true,
            data: { user: { id: 1, email: 'ada@example.com' } },
            error: null,
            requestId: 'abc-123',
        });

        expect(envelope).toEqual({
            ok: true,
            data: { user: { id: 1, email: 'ada@example.com' } },
            error: null,
            requestId: 'abc-123',
        });
    });

    it('preserves the error code, message and field details', () => {
        const envelope = normalizeEnvelope({
            ok: false,
            data: null,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'The request contains invalid fields.',
                details: [{ field: 'email', code: 'INVALID' }],
            },
            requestId: 'r-1',
        });

        expect(envelope.ok).toBe(false);
        expect(envelope.data).toBeNull();
        expect(envelope.error?.code).toBe('VALIDATION_ERROR');
        expect(envelope.error?.details).toEqual([{ field: 'email', code: 'INVALID' }]);
    });

    it('treats malformed bodies as UNKNOWN failures instead of crashing', () => {
        expect(normalizeEnvelope(null).error?.code).toBe('UNKNOWN');
        expect(normalizeEnvelope('nope').error?.code).toBe('UNKNOWN');
        expect(normalizeEnvelope([1, 2]).error?.code).toBe('UNKNOWN');
        expect(normalizeEnvelope(undefined).ok).toBe(false);
    });

    it('coerces missing requestId to empty string', () => {
        expect(normalizeEnvelope({ ok: true, data: null, error: null }).requestId).toBe('');
    });
});

describe('unwrapEnvelope', () => {
    it('returns data on success', () => {
        expect(unwrapEnvelope({ ok: true, data: { x: 1 }, error: null, requestId: 'r' })).toEqual({ x: 1 });
    });

    it('throws ApiError with the stable code on failure', () => {
        expect(() =>
            unwrapEnvelope({ ok: false, data: null, error: { code: 'RATE_LIMITED', message: 'Too many.' }, requestId: 'r' }),
        ).toThrow(ApiError);

        try {
            unwrapEnvelope({ ok: false, data: null, error: { code: 'INVALID_CREDENTIALS', message: 'No match.' }, requestId: 'r' });
            expect.unreachable('must throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect((error as ApiError).code).toBe('INVALID_CREDENTIALS');
            expect((error as ApiError).message).toBe('No match.');
        }
    });

    it('carries field-level details on the ApiError', () => {
        try {
            unwrapEnvelope({
                ok: false,
                data: null,
                error: { code: 'VALIDATION_ERROR', message: 'Invalid.', details: [{ field: 'title', code: 'INVALID' }] },
                requestId: 'r',
            });
            expect.unreachable('must throw');
        } catch (error) {
            expect((error as ApiError).details).toEqual([{ field: 'title', code: 'INVALID' }]);
        }
    });
});
