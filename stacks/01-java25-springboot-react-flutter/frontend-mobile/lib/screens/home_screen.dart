import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import 'algorithm_screen.dart';
import 'login_screen.dart';

/// Journey C — protected Home.
///
/// Contract: GET /api/v1/home (session cookie required) -> envelope data
/// {email, demo, metrics[{label,value,unit}], serverTime}; 401 UNAUTHORIZED
/// redirects to login. Logout calls POST /api/v1/logout (server-side session
/// invalidation) and clears the stored cookie.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _loading = true;
  String? _error;
  String? _email;
  bool _demo = false;
  List<Map<String, dynamic>> _metrics = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.home();
      if (!mounted) return;
      setState(() {
        _email = data['email'] as String?;
        _demo = data['demo'] as bool? ?? false;
        _metrics = (data['metrics'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        _loading = false;
      });
    } on ApiError catch (error) {
      if (!mounted) return;
      if (error.statusCode == 401) {
        _goToLogin();
        return;
      }
      setState(() {
        _error = error.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Network error. Please try again.';
        _loading = false;
      });
    }
  }

  Future<void> _goToLogin() async {
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) => LoginScreen(api: widget.api, storage: const FlutterSecureStorage()),
      ),
      (route) => false,
    );
  }

  Future<void> _logout() async {
    try {
      await widget.api.logout();
    } finally {
      await const FlutterSecureStorage().delete(key: 'stack01_session');
      if (mounted) await _goToLogin();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(onPressed: _logout, icon: const Icon(Icons.logout), tooltip: 'Log out'),
        ],
      ),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(child: Text('Error: $_error'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_demo)
            Text(
              'Demo data — you are not logged in.',
              style: TextStyle(color: Theme.of(context).colorScheme.tertiary),
            ),
          Text('Signed in as ${_email ?? '-'}', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          ..._metrics.map(
            (m) => ListTile(
              title: Text('${m['label']}'),
              trailing: Text('${m['value']} ${m['unit']}'),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => AlgorithmScreen(api: widget.api)),
            ),
            child: const Text('Open algorithm workbench'),
          ),
        ],
      ),
    );
  }
}
