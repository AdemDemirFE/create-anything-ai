import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api/api_client.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

void main() {
  runApp(const Stack15App());
}

/// App entry point. The four-screen journey starts at Login/Register; a
/// persisted session cookie (secure storage, never plain preferences) is
/// replayed into the ApiClient before the first protected call.
class Stack15App extends StatelessWidget {
  const Stack15App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Stack 15',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const Bootstrap(),
    );
  }
}

class Bootstrap extends StatefulWidget {
  const Bootstrap({super.key});

  @override
  State<Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<Bootstrap> {
  final ApiClient _api = ApiClient();
  bool _restoring = true;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    const storage = FlutterSecureStorage();
    final cookie = await storage.read(key: 'stack15_session');
    if (cookie != null) {
      await _api.restoreSession(cookie);
    }
    if (!mounted) return;
    setState(() => _restoring = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_restoring) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    // With a restored cookie the journey starts at Home; otherwise at Login.
    return _api.currentSessionCookie != null
        ? HomeScreen(api: _api, storage: const FlutterSecureStorage())
        : LoginScreen(api: _api, storage: const FlutterSecureStorage());
  }
}
