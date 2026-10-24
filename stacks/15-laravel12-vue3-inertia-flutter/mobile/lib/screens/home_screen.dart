import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../api/envelope.dart';
import 'notes_screen.dart';
import 'login_screen.dart';

/// Screen C — Home/dashboard: profile + metrics, entries into Notes (list)
/// and logout. 401 (UNAUTHENTICATED, e.g. revoked session) sends back to
/// login.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.api,
    required this.storage,
    this.user,
  });

  final ApiClient api;
  final FlutterSecureStorage storage;
  final Map<String, dynamic>? user;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _home;
  String? _error;
  bool _busy = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final home = await widget.api.home();
      if (!mounted) return;
      setState(() => _home = home);
    } on ApiError catch (e) {
      if (!mounted) return;
      if (e.status == 401) {
        await _toLogin();
        return;
      }
      setState(() => _error = e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toLogin() async {
    await widget.storage.delete(key: 'stack15_session');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) =>
            LoginScreen(api: widget.api, storage: widget.storage),
      ),
    );
  }

  Future<void> _logout() async {
    try {
      await widget.api.logout();
    } finally {
      await _toLogin();
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = _home?['user'] as Map<String, dynamic>? ?? widget.user;
    final metrics =
        _home?['metrics'] as List? ?? const <dynamic>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(
            tooltip: 'Log out',
            onPressed: _busy ? null : _logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: _busy
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(
                      'Welcome, ${user?['name'] ?? 'user'}',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text('${user?['email'] ?? ''}'),
                    const SizedBox(height: 16),
                    ...metrics.map(
                      (m) => Card(
                        child: ListTile(
                          title: Text('${(m as Map<String, dynamic>)['label']}'),
                          trailing: Text(
                            '${m['value']}',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => NotesScreen(
                            api: widget.api,
                          ),
                        ),
                      ),
                      child: const Text('My notes'),
                    ),
                  ],
                ),
    );
  }
}
