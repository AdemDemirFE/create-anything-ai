import 'package:flutter/material.dart';

import '../api/api_client.dart';
import 'home_screen.dart';

/// Journey A — Register.
///
/// Contract: POST /api/v1/register {email, password} -> 201 with envelope data
/// {email}; 409 EMAIL_TAKEN; 400 VALIDATION_ERROR with field details.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
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
      await widget.api.register(_emailController.text.trim(), _passwordController.text);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => HomeScreen(api: widget.api)),
      );
    } on ApiError catch (error) {
      setState(() {
        _errorMessage = switch (error.code) {
          'EMAIL_TAKEN' => 'An account with this email already exists.',
          'VALIDATION_ERROR' => 'Check your email and password (min 10 chars, letters + numbers).',
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
      appBar: AppBar(title: const Text('Create account')),
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
                    value == null || !value.contains('@') ? 'Enter a valid email' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _passwordController,
                decoration: const InputDecoration(
                  labelText: 'Password',
                  helperText: 'At least 10 characters with letters and numbers',
                ),
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                validator: (value) =>
                    value != null && value.length >= 10 ? null : 'Minimum 10 characters',
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
                child: Text(_submitting ? 'Creating account…' : 'Register'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
