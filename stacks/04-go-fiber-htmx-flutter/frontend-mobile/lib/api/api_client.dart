import 'dart:convert';

import 'package:http/http.dart' as http;

/// Thrown for every non-success envelope; carries the stable error code
/// (INVALID_CREDENTIALS, EMAIL_TAKEN, RATE_LIMITED, INPUT_TOO_LARGE, ...).
class ApiError implements Exception {
  ApiError(this.code, this.message, this.statusCode);

  final String code;
  final String message;
  final int statusCode;

  @override
  String toString() => 'ApiError($code, $statusCode): $message';
}

/// API client for the Stack 04 backend (Go / Fiber).
///
/// Envelope contract (docs/PRODUCT_REQUIREMENTS.md section 7):
/// { success, data, error{code,message,details}, meta{timestamp,execution_ms,request_id} }
///
/// Session handling: the backend authenticates with an opaque session cookie
/// (STACK04_SESSION, HttpOnly, SameSite=Lax). On Android/iOS the http package
/// does not manage cookies per default, so the cookie value is persisted with
/// flutter_secure_storage (never plain preferences) and replayed on every
/// request.
class ApiClient {
  ApiClient({http.Client? client, this.baseUrl = 'http://10.0.2.2:8080'})
      : _client = client ?? http.Client();

  /// 10.0.2.2 is the Android emulator alias for host localhost.
  final String baseUrl;
  final http.Client _client;

  static const _sessionCookieHeader = 'STACK04_SESSION';
  String? _sessionCookie;

  /// Restores the persisted session cookie at app start.
  Future<void> restoreSession(String cookie) async {
    _sessionCookie = cookie;
  }

  String? get currentSessionCookie => _sessionCookie;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (_sessionCookie != null)
          'Cookie': '$_sessionCookieHeader=$_sessionCookie',
      };

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
  }) async {
    final uri = Uri.parse('$baseUrl/api/v1$path');
    late final http.Response response;
    switch (method) {
      case 'POST':
        response = await _client.post(uri,
            headers: _headers, body: jsonEncode(body ?? {}));
        break;
      case 'GET':
      default:
        response = await _client.get(uri, headers: _headers);
    }

    final dynamic decoded =
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;

    // Track the session cookie from any response (login sets it).
    final setCookies = response.headers['set-cookie'];
    if (setCookies != null && setCookies.contains('$_sessionCookieHeader=')) {
      final match =
          RegExp('$_sessionCookieHeader=([^;]+)').firstMatch(setCookies);
      if (match != null) {
        _sessionCookie = match.group(1);
      }
    }

    final success = decoded['success'] as bool? ?? false;
    if (!success) {
      final error = decoded['error'] as Map<String, dynamic>?;
      throw ApiError(
        error?['code'] as String? ?? 'UNKNOWN',
        error?['message'] as String? ?? 'Request failed.',
        response.statusCode,
      );
    }
    return (decoded['data'] as Map<String, dynamic>? ?? {});
  }

  /// POST /register -> 201 on success; EMAIL_TAKEN on 409.
  Future<void> register(String email, String password) async {
    await _send('POST', '/register', body: {'email': email, 'password': password});
  }

  /// POST /login -> stores the session cookie on success.
  Future<void> login(String email, String password) async {
    await _send('POST', '/login', body: {'email': email, 'password': password});
  }

  /// POST /logout -> server-side session invalidation; clears the cookie.
  Future<void> logout() async {
    try {
      await _send('POST', '/logout', body: {});
    } finally {
      _sessionCookie = null;
    }
  }

  /// GET /home -> {email, metrics[], server_time}.
  Future<Map<String, dynamic>> home() => _send('GET', '/home');

  /// GET /algorithm -> fixed algorithm catalog.
  Future<List<dynamic>> algorithms() async {
    final data = await _send('GET', '/algorithm');
    return data is List ? data : (data['items'] as List? ?? const []);
  }

  /// POST /algorithm/run -> {output, execution_ms, complexity, explanation}.
  Future<Map<String, dynamic>> runAlgorithm(String id, String input) {
    return _send('POST', '/algorithm/run',
        body: {'algorithm_id': id, 'input': input});
  }
}
