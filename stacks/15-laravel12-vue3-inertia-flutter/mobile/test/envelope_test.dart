import 'package:flutter_test/flutter_test.dart';
import 'package:stack15_mobile/api/envelope.dart';

void main() {
  group('Envelope normalization (mirrors laravel/resources/js/lib/envelope.ts)', () {
    test('success envelope unwraps data and requestId', () {
      final data = unwrapEnvelope({
        'ok': true,
        'data': {'note': {'id': 7, 'title': 'Groceries'}},
        'error': null,
        'requestId': '0a1b2c3d',
      });
      expect(data['note']['id'], 7);
      expect(data['note']['title'], 'Groceries');
    });

    test('failure envelope raises ApiError with stable code + status carrier', () {
      final error = ApiError(
        'INVALID_CREDENTIALS',
        'These credentials do not match our records.',
        status: 401,
        requestId: '0a1b2c3d',
      );
      expect(error.code, 'INVALID_CREDENTIALS');
      expect(error.status, 401);
      expect(error.toString(), contains('INVALID_CREDENTIALS'));
    });

    test('VALIDATION_ERROR details are preserved', () {
      final envelope = normalizeEnvelope({
        'ok': false,
        'data': null,
        'error': {
          'code': 'VALIDATION_ERROR',
          'message': 'The request contains invalid fields.',
          'details': [
            {'field': 'email', 'code': 'INVALID'},
            {'field': 'password', 'code': 'INVALID'},
          ],
        },
        'requestId': 'x',
      });
      expect(envelope.ok, isFalse);
      expect(envelope.error!.code, 'VALIDATION_ERROR');
      expect(envelope.error!.details.length, 2);
      expect(envelope.error!.details.first.field, 'email');
    });

    test('foreign/legacy body is treated as UNKNOWN failure, not a crash', () {
      final envelope = normalizeEnvelope({'hello': 'world'});
      expect(envelope.ok, isFalse);
      expect(envelope.error!.code, 'UNKNOWN');
      expect(envelope.data, isNull);
    });

    test('non-object body (array, string, null) normalizes to UNKNOWN failure', () {
      for (final body in [null, [1, 2, 3], 'nope']) {
        final envelope = normalizeEnvelope(body);
        expect(envelope.ok, isFalse, reason: 'body: $body');
        expect(envelope.error!.code, 'UNKNOWN', reason: 'body: $body');
      }
    });

    test('missing requestId normalizes to empty string', () {
      final envelope = normalizeEnvelope({'ok': true, 'data': {}});
      expect(envelope.requestId, '');
    });
  });
}
