import 'dart:convert';

import 'package:http/http.dart' as http;

import 'envelope.dart';

/// API client for the Stack 15 backend (Laravel 12 / Inertia).
///
/// Envelope contract (ARCHITECTURE.md, mirrored in `envelope.dart`):
/// { ok, data, error{code,message,details}, requestId }
///
/// Session handling: the backend authenticates /api/v1 with the SAME Laravel
/// session as the Inertia pages (HttpOnly cookie, `stack15_session`).
/// On Android/iOS the http package does not manage cookies by default, so the
/// cookie value is persisted with flutter_secure_storage (never plain
/// preferences) and replayed on every request. Cross-site POST abuse is
/// mitigated server-side by SameSite=lax (see ARCHITECTURE.md).
class ApiClient {
  ApiClient({http.Client? client, this.baseUrl = 'http://10.0.2.2:8000'})
    : _client = client ?? http.Client();

  /// 10.0.2.2 is the Android emulator alias for host localhost; `php artisan
  /// serve` listens on :8000 by default.
  final String baseUrl;
  final http.Client _client;

  static const _sessionCookieHeader = 'stack15_session';
  static const _requestIdHeader = 'X-Request-Id';

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
    final http.Response response;
    switch (method) {
      case 'POST':
        response = await _client.post(
          uri,
          headers: _headers,
          body: jsonEncode(body ?? {}),
        );
        break;
      case 'PUT':
        response = await _client.put(
          uri,
          headers: _headers,
          body: jsonEncode(body ?? {}),
        );
        break;
      case 'DELETE':
        response = await _client.delete(uri, headers: _headers);
        break;
      case 'GET':
      default:
        response = await _client.get(uri, headers: _headers);
    }

    // Track the session cookie from any response (login/register set it).
    final setCookies = response.headers['set-cookie'];
    if (setCookies != null &&
        setCookies.contains('$_sessionCookieHeader=')) {
      final match = RegExp(
        '$_sessionCookieHeader=([^;]+)',
      ).firstMatch(setCookies);
      if (match != null) {
        _sessionCookie = match.group(1);
      }
    }

    final dynamic decoded = jsonDecode(utf8.decode(response.bodyBytes));
    final envelope = normalizeEnvelope(decoded);
    if (!envelope.ok) {
      throw ApiError(
        envelope.error?.code ?? 'UNKNOWN',
        envelope.error?.message ?? 'Request failed.',
        status: response.statusCode,
        details: envelope.error?.details ?? const [],
        requestId: envelope.requestId,
      );
    }
    return envelope.data ?? <String, dynamic>{};
  }

  /// GET /health -> {service, time}; used by the bootstrap ping.
  Future<Map<String, dynamic>> health() => _send('GET', '/health');

  /// POST /register -> 201 + {user}; EMAIL_TAKEN surfaces as a field error
  /// under "email" (no account-existence wording).
  Future<Map<String, dynamic>> register(
    String name,
    String email,
    String password,
  ) => _send('POST', '/register', body: {
        'name': name,
        'email': email,
        'password': password,
      });

  /// POST /login -> {user}; generic INVALID_CREDENTIALS for unknown email
  /// AND wrong password; RATE_LIMITED (429 + Retry-After) after repeated
  /// failed attempts — the lockout is NOT bypassed by the correct password.
  Future<Map<String, dynamic>> login(String email, String password) =>
      _send('POST', '/login', body: {'email': email, 'password': password});

  /// GET /me -> {user}; 401 UNAUTHENTICATED when the session is gone
  /// (e.g. after logout) — screens treat it as "back to login".
  Future<Map<String, dynamic>> me() => _send('GET', '/me');

  /// GET /home -> {user, metrics[], serverTime}.
  Future<Map<String, dynamic>> home() => _send('GET', '/home');

  /// POST /logout -> server-side session invalidation; clears the cookie.
  Future<void> logout() async {
    try {
      await _send('POST', '/logout', body: {});
    } finally {
      _sessionCookie = null;
    }
  }

  /// GET /notes -> {notes: [...]}, newest first.
  Future<List<dynamic>> notes() async {
    final data = await _send('GET', '/notes');
    return data['notes'] as List? ?? const [];
  }

  /// POST /notes -> 201 + {note}.
  Future<Map<String, dynamic>> createNote(String title, String? body) =>
      _send('POST', '/notes', body: {'title': title, 'body': body});

  /// GET /notes/{id} -> {note}; 403 FORBIDDEN for a foreign note, 404
  /// NOT_FOUND when it does not exist.
  Future<Map<String, dynamic>> note(int id) => _send('GET', '/notes/$id');

  /// PUT /notes/{id} -> {note}.
  Future<Map<String, dynamic>> updateNote(
    int id,
    String title,
    String? body,
  ) => _send('PUT', '/notes/$id', body: {'title': title, 'body': body});

  /// DELETE /notes/{id} -> {deleted: true}.
  Future<Map<String, dynamic>> deleteNote(int id) =>
      _send('DELETE', '/notes/$id');

  /// GET /algorithm -> {algorithms: [...], maxInputLength}.
  Future<List<dynamic>> algorithms() async {
    final data = await _send('GET', '/algorithm');
    return data['algorithms'] as List? ?? const [];
  }

  /// POST /algorithm/run -> {algorithm, input_preview, output, execution_ms,
  /// complexity, explanation}; UNKNOWN_ALGORITHM / INPUT_TOO_LARGE /
  /// INVALID_INPUT arrive as ApiError codes.
  Future<Map<String, dynamic>> runAlgorithm(String id, String input) =>
      _send('POST', '/algorithm/run', body: {
        'algorithmId': id,
        'input': input,
      });
}
