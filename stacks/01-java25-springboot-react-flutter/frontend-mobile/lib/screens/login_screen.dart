import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import 'home_screen.dart';
import 'register_screen.dart';

/// Journey B — Login.
///
/// Contract: POST /api/v1/login {email, password} -> 200 envelope {email} and
/// the STACK01_SESSION cookie; 400 INVALID_CREDENTIALS (same message for
/// unknown email and wrong password - no enumeration); 400 RATE_LIMITED.
///
/// The session cookie is stored with flutter_secure_storage (Keychain /
/// Keystore-backed), never in plain preferences.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.storage});

  final ApiClient api;
  final FlutterSecureStorage storage;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _submitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    try {
      await widget.api.login(_emailController.text.trim(), _passwordController.text);
      final cookie = widget.api.currentSessionCookie;
      if (cookie != null) {
        await widget.storage.write(key: 'stack01_session', value: cookie);
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => HomeScreen(api: widget.api)),
      );
    } on ApiError catch (error) {
      setState(() {
        _errorMessage = switch (error.code) {
          'INVALID_CREDENTIALS' => 'Invalid email or password.',
          'RATE_LIMITED' => 'Too many attempts. Please wait a minute.',
          _ => error.message,
        };
      });
    } catch (_) {
      setState(() => _errorMessage = 'Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Log in')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _emailController,
                decoration: const InputDecoration(labelText: 'Email'),
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                validator: (value) =>
                    value == null || value.isEmpty ? 'Enter your email' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _passwordController,
                decoration: const InputDecoration(labelText: 'Password'),
                obscureText: true,
                autofillHints: const [AutofillHints.password],
                validator: (value) =>
                    value == null || value.isEmpty ? 'Enter your password' : null,
              ),
              if (_errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMessage!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: Text(_submitting ? 'Logging in…' : 'Log in'),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => RegisterScreen(api: widget.api)),
                ),
                child: const Text('No account yet? Register'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
