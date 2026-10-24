import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/envelope.dart';

/// The algorithm workbench, mobile variant: fixed catalog only, input capped
/// client-side at maxInputLength (server re-validates and rejects oversized
/// input with INPUT_TOO_LARGE — never truncates). Measured execution_ms and
/// the static Big-O note are displayed separately.
class WorkbenchScreen extends StatefulWidget {
  const WorkbenchScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<WorkbenchScreen> createState() => _WorkbenchScreenState();
}

class _WorkbenchScreenState extends State<WorkbenchScreen> {
  // Mirrors AlgorithmEngine::MAX_INPUT_LENGTH on the server; the server
  // re-validates and rejects oversized input with INPUT_TOO_LARGE.
  static const _maxInputLength = 10000;

  List<dynamic> _catalog = const [];
  String? _selectedId;
  final _input = TextEditingController();
  Map<String, dynamic>? _result;
  String? _error;
  bool _busy = true;
  bool _running = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _busy = true);
    try {
      final data = await widget.api.algorithms();
      if (!mounted) return;
      setState(() => _catalog = data);
    } catch (_) {
      // catalog load failure is non-fatal; run() reports errors
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _run() async {
    if (_selectedId == null) return;
    setState(() {
      _running = true;
      _error = null;
      _result = null;
    });
    try {
      final result = await widget.api.runAlgorithm(
        _selectedId!,
        _input.text,
      );
      if (!mounted) return;
      setState(() => _result = result);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
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
      body: _busy
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                DropdownButtonFormField<String>(
                  initialValue: _selectedId,
                  decoration: const InputDecoration(labelText: 'Algorithm'),
                  items: _catalog
                      .map((a) => DropdownMenuItem(
                            value: (a as Map<String, dynamic>)['id'] as String,
                            child: Text('${a['label']} (${a['complexity']})'),
                          ))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedId = v),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _input,
                  decoration: InputDecoration(
                    labelText: 'Input',
                    helperText: 'Max $_maxInputLength characters.',
                  ),
                  maxLength: _maxInputLength,
                  maxLines: 3,
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: (_running || _selectedId == null) ? null : _run,
                  child: Text(_running ? 'Running…' : 'Run'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
                if (_result != null) ...[
                  const SizedBox(height: 16),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Output: ${_result!['output']}'),
                          const SizedBox(height: 8),
                          Text(
                            // Measured time and theoretical complexity stay
                            // separate (PRODUCT_REQUIREMENTS.md section 6).
                            'Measured: ${_result!['execution_ms']} ms · '
                            'Big-O: ${_result!['complexity']}',
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}
