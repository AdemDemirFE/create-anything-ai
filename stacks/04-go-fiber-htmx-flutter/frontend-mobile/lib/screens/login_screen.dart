import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import 'home_screen.dart';

/// Journey B — Login.
///
/// Contract: POST /api/v1/login -> session cookie (stored in secure storage).
/// INVALID_CREDENTIALS shows a generic message (no enumeration);
/// RATE_LIMITED (429) shows the wait message. Both are visible states.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.storage});

  final ApiClient api;
  final FlutterSecureStorage storage;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.login(_email.text.trim(), _password.text);
      final cookie = widget.api.currentSessionCookie;
      if (cookie != null) {
        await widget.storage.write(key: 'stack04_session', value: cookie);
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => HomeScreen(api: widget.api)),
      );
    } on ApiError catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = switch (error.code) {
          'INVALID_CREDENTIALS' => 'Invalid email or password.',
          'RATE_LIMITED' => 'Too many failed attempts. Please wait a minute.',
          _ => error.message,
        };
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'Network error. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Log in')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ...[
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 8),
          ],
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email'),
          ),
          TextField(
            controller: _password,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Password'),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? 'Logging in…' : 'Log in'),
          ),
          TextButton(
            onPressed: _busy
                ? null
                : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => RegisterScreen(
                            api: widget.api, storage: widget.storage),
                      ),
                    ),
            child: const Text('No account? Register'),
          ),
        ],
      ),
    );
  }
}
