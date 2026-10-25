import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/envelope.dart';

/// Screen D — Notes (list + form + detail) and the algorithm workbench.
/// The server enforces ownership (403 for foreign notes) and input bounds
/// (422 VALIDATION_ERROR); the client only renders what the envelope says.
class NotesScreen extends StatefulWidget {
  const NotesScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends State<NotesScreen> {
  List<dynamic> _notes = const [];
  bool _busy = true;
  String? _error;

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
      final notes = await widget.api.notes();
      if (!mounted) return;
      setState(() => _notes = notes);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _createOrEdit({Map<String, dynamic>? existing}) async {
    final title = TextEditingController(text: existing?['title'] as String? ?? '');
    final body = TextEditingController(text: existing?['body'] as String? ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(existing == null ? 'New note' : 'Edit note'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: title,
              decoration: const InputDecoration(labelText: 'Title'),
              maxLength: 120,
            ),
            TextField(
              controller: body,
              decoration: const InputDecoration(labelText: 'Body'),
              maxLines: 4,
              maxLength: 5000,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (saved != true || !mounted) return;

    try {
      if (existing == null) {
        await widget.api.createNote(title.text.trim(), body.text);
      } else {
        await widget.api.updateNote(
          existing['id'] as int,
          title.text.trim(),
          body.text,
        );
      }
      if (!mounted) return;
      await _load();
    } on ApiError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _open(Map<String, dynamic> note) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _NoteDetailScreen(api: widget.api, noteId: note['id'] as int),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My notes')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _createOrEdit(),
        child: const Icon(Icons.add),
      ),
      body: _busy
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : _notes.isEmpty
                  ? const Center(child: Text('No notes yet.'))
                  : ListView.builder(
                      itemCount: _notes.length,
                      itemBuilder: (context, i) {
                        final note = _notes[i] as Map<String, dynamic>;
                        return Card(
                          child: ListTile(
                            title: Text('${note['title']}'),
                            subtitle: Text(
                              '${note['body'] ?? ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            onTap: () => _open(note),
                          ),
                        );
                      },
                    ),
    );
  }
}

class _NoteDetailScreen extends StatefulWidget {
  const _NoteDetailScreen({required this.api, required this.noteId});

  final ApiClient api;
  final int noteId;

  @override
  State<_NoteDetailScreen> createState() => _NoteDetailScreenState();
}

class _NoteDetailScreenState extends State<_NoteDetailScreen> {
  Map<String, dynamic>? _note;
  bool _busy = true;
  String? _error;

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
      final data = await widget.api.note(widget.noteId);
      if (!mounted) return;
      setState(() => _note = data['note'] as Map<String, dynamic>?);
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    try {
      await widget.api.deleteNote(widget.noteId);
    } on ApiError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      return;
    }
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_note?['title'] as String? ?? 'Note'),
        actions: [
          IconButton(
            tooltip: 'Delete',
            onPressed: _busy ? null : _delete,
            icon: const Icon(Icons.delete),
          ),
        ],
      ),
      body: _busy
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('${_note?['body'] ?? ''}'),
                ),
    );
  }
}
