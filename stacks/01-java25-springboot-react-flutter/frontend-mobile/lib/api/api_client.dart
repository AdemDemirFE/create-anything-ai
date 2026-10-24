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

/// API client for the Stack 01 backend.
///
/// Envelope contract (docs/PRODUCT_REQUIREMENTS.md section 7):
/// { success, data, error{code,message,details}, meta{timestamp,execution_ms,request_id} }
///
/// Session handling: the backend authenticates with an opaque session cookie
/// (STACK01_SESSION). On Android/iOS, http.CookieJar is emulated by persisting
/// the cookie value with flutter_secure_storage (never plain preferences).
class ApiClient {
  ApiClient({http.Client? client, this.baseUrl = 'http://10.0.2.2:8080'})
      : _client = client ?? http.Client();

  /// 10.0.2.2 is the Android emulator alias for host localhost.
  final String baseUrl;
  final http.Client _client;

  static const _sessionCookieHeader = 'STACK01_SESSION';
  String? _sessionCookie;

  /// Restores the persisted session cookie at app start.
  Future<void> restoreSession(String cookie) async {
    _sessionCookie = cookie;
  }

  String? get currentSessionCookie => _sessionCookie;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (_sessionCookie != null) 'Cookie': '$_sessionCookieHeader=$_sessionCookie',
      };

  Future<Map<String, dynamic>> _send(String method, String path, {Object? body}) async {
    final uri = Uri.parse('$baseUrl/api/v1$path');
    late final http.Response response;
    switch (method) {
      case 'POST':
        response = await _client.post(uri, headers: _headers, body: jsonEncode(body ?? {}));
        break;
      case 'GET':
      default:
        response = await _client.get(uri, headers: _headers);
    }

    final dynamic decoded = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;

    final setCookies = response.headers['set-cookie'];
    if (setCookies != null && setCookies.contains('$_sessionCookieHeader=')) {
      final match = RegExp('$_sessionCookieHeader=([^;]+)').firstMatch(setCookies);
      if (match != null) {
        _sessionCookie = match.group(1);
      }
    }

    if (!(decoded['success'] as bool? ?? false) || response.statusCode >= 400) {
      final error = decoded['error'] as Map<String, dynamic>?;
      throw ApiError(
        error?['code'] as String? ?? 'UNKNOWN',
        error?['message'] as String? ?? 'Request failed.',
        response.statusCode,
      );
    }
    return decoded['data'] as Map<String, dynamic>? ?? <String, dynamic>{};
  }

  Future<void> register(String email, String password) async {
    await _send('POST', '/register', body: {'email': email, 'password': password});
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    return _send('POST', '/login', body: {'email': email, 'password': password});
  }

  Future<void> logout() async {
    try {
      await _send('POST', '/logout');
    } finally {
      _sessionCookie = null;
    }
  }

  Future<Map<String, dynamic>> me() => _send('GET', '/me');

  Future<Map<String, dynamic>> home() => _send('GET', '/home');

  Future<List<dynamic>> algorithms() async {
    final data = await _send('GET', '/algorithm');
    return data['items'] as List<dynamic>? ?? <dynamic>[];
  }

  Future<Map<String, dynamic>> runAlgorithm(String algorithmId, String input) =>
      _send('POST', '/algorithm/run', body: {'algorithm': algorithmId, 'input': input});

  void dispose() => _client.close();
}
