import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api/api_client.dart';
import 'screens/login_screen.dart';

void main() {
  runApp(const Stack04App());
}

/// App entry point. The four-screen journey starts at Login; a persisted
/// session cookie (secure storage) is replayed into the ApiClient before the
/// first protected call.
class Stack04App extends StatelessWidget {
  const Stack04App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Stack 04',
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
    final cookie = await storage.read(key: 'stack04_session');
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
    return LoginScreen(api: _api, storage: const FlutterSecureStorage());
  }
}
