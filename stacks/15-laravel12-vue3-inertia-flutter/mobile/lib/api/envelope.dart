/// Stack 15 — /api/v1 envelope contract (mobile side).
///
/// Mirrors `../laravel/resources/js/lib/envelope.ts` 1:1 so both clients
/// normalize the wire format identically. The envelope shape is defined in
/// `../../ARCHITECTURE.md` and produced by the Laravel backend
/// (`laravel/app/Http/Responses/Envelope.php`):
///
///   success: { ok: true,  data: {...}, error: null,
///              requestId: "<opaque or echoed X-Request-Id>" }
///   failure: { ok: false, data: null,
///              error: { code, message, details? }, requestId: "..." }
library;

/// Field-level validation detail as emitted by the backend envelope
/// (`VALIDATION_ERROR` responses, one entry per invalid field).
class EnvelopeErrorDetail {
  EnvelopeErrorDetail({required this.field, required this.code});

  final String field;
  final String code;
}

/// Structured error object from a failure envelope.
class EnvelopeError {
  EnvelopeError({
    required this.code,
    required this.message,
    this.details = const [],
  });

  final String code;
  final String message;
  final List<EnvelopeErrorDetail> details;
}

/// Thrown for every non-success envelope; carries the stable machine-readable
/// code (INVALID_CREDENTIALS, EMAIL_TAKEN, RATE_LIMITED, INPUT_TOO_LARGE, ...)
/// so screens can branch on it instead of parsing messages.
class ApiError implements Exception {
  ApiError(
    this.code,
    this.message, {
    this.status = 0,
    this.details = const [],
    this.requestId = '',
  });

  final String code;
  final String message;
  final int status;
  final List<EnvelopeErrorDetail> details;
  final String requestId;

  @override
  String toString() => 'ApiError($code, $status): $message';
}

/// Normalized envelope, the mobile twin of the TS `Envelope<T>` interface.
class Envelope<T> {
  const Envelope({
    required this.ok,
    required this.data,
    required this.error,
    required this.requestId,
  });

  final bool ok;
  final T? data;
  final EnvelopeError? error;
  final String requestId;
}

Object? _read(Map<String, dynamic> record, String key) => record[key];

/// Normalizes a raw decoded JSON body into the typed envelope.
///
/// Defensive: a legacy/foreign body without `ok` is treated as a failure with
/// UNKNOWN code instead of crashing the caller (same behavior as the TS
/// mirror).
Envelope<Map<String, dynamic>> normalizeEnvelope(Object? body) {
  if (body is! Map<String, dynamic>) {
    return Envelope(
      ok: false,
      data: null,
      error: EnvelopeError(code: 'UNKNOWN', message: 'Malformed response body.'),
      requestId: '',
    );
  }

  final dynamic rawError = _read(body, 'error');
  EnvelopeError? error;
  if (rawError != null) {
    final Map<String, dynamic> err = rawError is Map<String, dynamic>
        ? rawError
        : const <String, dynamic>{};
    final dynamic rawDetails = err['details'];
    final List<EnvelopeErrorDetail> details = rawDetails is List
        ? rawDetails
              .whereType<Map<String, dynamic>>()
              .map(
                (d) => EnvelopeErrorDetail(
                  field: '${d['field'] ?? ''}',
                  code: '${d['code'] ?? 'INVALID'}',
                ),
              )
              .toList()
        : <EnvelopeErrorDetail>[];
    error = EnvelopeError(
      code: err['code'] is String ? err['code'] as String : 'UNKNOWN',
      message: err['message'] is String ? err['message'] as String : 'Request failed.',
      details: details,
    );
  }

  return Envelope(
    ok: body['ok'] == true,
    data: body['data'] is Map<String, dynamic>
        ? body['data'] as Map<String, dynamic>
        : null,
    error: error,
    requestId: body['requestId'] is String ? body['requestId'] as String : '',
  );
}

/// Normalizes and unwraps; throws [ApiError] on failure envelopes.
Map<String, dynamic> unwrapEnvelope(Object? body) {
  final envelope = normalizeEnvelope(body);
  if (!envelope.ok) {
    throw ApiError(
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.message ?? 'Request failed.',
      details: envelope.error?.details ?? const [],
      requestId: envelope.requestId,
    );
  }
  return envelope.data ?? <String, dynamic>{};
}
