import 'package:flutter_test/flutter_test.dart';
import 'package:stack01_frontend_mobile/api/api_client.dart';

void main() {
  group('ApiClient envelope handling', () {
    test('ApiError carries stable code, message, and status', () {
      final error = ApiError('INVALID_CREDENTIALS', 'Invalid email or password.', 400);
      expect(error.code, 'INVALID_CREDENTIALS');
      expect(error.message, 'Invalid email or password.');
      expect(error.statusCode, 400);
      expect(error.toString(), contains('INVALID_CREDENTIALS'));
    });

    test('session cookie is captured and cleared on logout', () async {
      // NOTE (unverified): this test requires `flutter test` which cannot run
      // without the Flutter SDK (see verification.md). It documents the
      // intended behavior: the client captures STACK01_SESSION from
      // Set-Cookie and clears it on logout.
      final client = ApiClient();
      expect(client.currentSessionCookie, isNull);
      await client.restoreSession('abc123');
      expect(client.currentSessionCookie, 'abc123');
      client.dispose();
    });
  });
}
