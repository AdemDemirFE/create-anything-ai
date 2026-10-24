import 'package:flutter/material.dart';

import '../api/api_client.dart';

/// Journey D — Algorithm workbench.
///
/// Security model (mirrors the backend contract):
/// - The user picks a FIXED algorithm from the catalog; user code is never
///   executed, there is no code input field at all.
/// - Input length is capped client-side at 10,000 characters (the backend
///   re-validates; INPUT_TOO_LARGE is surfaced as a visible error).
/// - The result distinguishes MEASURED duration (executionMs, monotonic clock
///   server-side) from THEORETICAL Big-O (complexity + explanation). The UI
///   never claims microsecond precision.
class AlgorithmScreen extends StatefulWidget {
  const AlgorithmScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<AlgorithmScreen> createState() => _AlgorithmScreenState();
}

class _AlgorithmScreenState extends State<AlgorithmScreen> {
  static const _maxInputLength = 10000;

  bool _loadingCatalog = true;
  String? _error;
  List<Map<String, dynamic>> _catalog = const [];
  String _selectedId = '';
  final _inputController = TextEditingController();
  bool _running = false;
  Map<String, dynamic>? _result;

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  @override
  void dispose() {
    _inputController.dispose();
    super.dispose();
  }

  Future<void> _loadCatalog() async {
    setState(() => _loadingCatalog = true);
    try {
      final items = await widget.api.algorithms();
      if (!mounted) return;
      setState(() {
        _catalog = items.whereType<Map<String, dynamic>>().toList();
        if (_catalog.isNotEmpty && _selectedId.isEmpty) {
          _selectedId = _catalog.first['id'] as String;
        }
        _loadingCatalog = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load the algorithm catalog.';
        _loadingCatalog = false;
      });
    }
  }

  Future<void> _run() async {
    final algorithm = _selectedId;
    final input = _inputController.text;
    if (algorithm.isEmpty || input.isEmpty) return;
    setState(() {
      _running = true;
      _error = null;
      _result = null;
    });
    try {
      final data = await widget.api.runAlgorithm(algorithm, input);
      if (!mounted) return;
      setState(() => _result = data);
    } on ApiError catch (error) {
      if (!mounted) return;
      setState(() => _error = switch (error.code) {
            'INPUT_TOO_LARGE' =>
              'Input exceeds the maximum length of $_maxInputLength characters.',
            'UNKNOWN_ALGORITHM' => 'Unknown algorithm.',
            _ => error.message,
          });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Algorithm workbench')),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loadingCatalog) {
      return const Center(child: CircularProgressIndicator());
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DropdownButtonFormField<String>(
          initialValue: _selectedId.isEmpty ? null : _selectedId,
          decoration: const InputDecoration(labelText: 'Algorithm'),
          items: _catalog
              .map((a) => DropdownMenuItem<String>(
                    value: a['id'] as String,
                    child: Text('${a['name']} (${a['complexity']})'),
                  ))
              .toList(),
          onChanged: (value) => setState(() => _selectedId = value ?? _selectedId),
        ),
        if (_selectedInfo != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_selectedInfo!['explanation'] as String? ?? ''),
          ),
        const SizedBox(height: 12),
        TextField(
          controller: _inputController,
          maxLength: _maxInputLength,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Input',
            helperText: 'Bounded text; your own code is never executed',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _running ? null : _run,
          child: Text(_running ? 'Running…' : 'Run'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
        if (_result != null) ...[
          const SizedBox(height: 24),
          Text('Result', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('${_result!['output']}'),
          ),
          const SizedBox(height: 8),
          Text(
            'Measured duration: ${(_result!['execution_ms'] as num?)?.toStringAsFixed(1) ?? '?'} ms '
            '(server-side monotonic clock)',
          ),
          Text(
            'Theoretical complexity: ${_result!['complexity']} — ${_result!['explanation']}\n'
            'Measured time and Big-O are different things; small inputs do not prove complexity.',
          ),
        ],
      ],
    );
  }

  Map<String, dynamic>? get _selectedInfo {
    for (final item in _catalog) {
      if (item['id'] == _selectedId) return item;
    }
    return null;
  }
}
