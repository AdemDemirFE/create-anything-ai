import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../api/envelope.dart';
import 'home_screen.dart';

/// Screen A — Register. Validation errors arrive as VALIDATION_ERROR with
/// field details; a duplicate email presents like any other invalid field
/// (no account-existence wording, anti-enumeration).
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.api, required this.storage});

  final ApiClient api;
  final FlutterSecureStorage storage;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  Map<String, String> _fieldErrors = {};
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
      _fieldErrors = {};
    });
    try {
      final user = await widget.api.register(
        _name.text.trim(),
        _email.text.trim(),
        _password.text,
      );
      final cookie = widget.api.currentSessionCookie;
      if (cookie != null) {
        await widget.storage.write(key: 'stack15_session', value: cookie);
      }
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => HomeScreen(
            api: widget.api,
            storage: widget.storage,
            user: user,
          ),
        ),
      );
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _fieldErrors = {
          for (final d in e.details) d.field: 'Invalid value.',
        };
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Create account')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _name,
              decoration: InputDecoration(
                labelText: 'Name',
                errorText: _fieldErrors['name'],
              ),
              textInputAction: TextInputAction.next,
              validator: (v) =>
                  (v == null || v.trim().length < 2) ? 'Name is required.' : null,
            ),
            TextFormField(
              controller: _email,
              decoration: InputDecoration(
                labelText: 'Email',
                errorText: _fieldErrors['email'],
              ),
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Email is required.' : null,
            ),
            TextFormField(
              controller: _password,
              decoration: InputDecoration(
                labelText: 'Password',
                errorText: _fieldErrors['password'],
                helperText: 'At least 8 characters, letters and numbers.',
              ),
              obscureText: true,
              autofillHints: const [AutofillHints.newPassword],
              validator: (v) =>
                  (v == null || v.isEmpty) ? 'Password is required.' : null,
            ),
            if (_error != null && _fieldErrors.isEmpty) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: Text(_busy ? 'Creating…' : 'Create account'),
            ),
          ],
        ),
      ),
    );
  }
}
