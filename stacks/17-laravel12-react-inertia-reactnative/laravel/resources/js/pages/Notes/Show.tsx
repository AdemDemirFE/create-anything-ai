import { Head, router } from '@inertiajs/react';
import type { NoteDto } from '../../types';

export default function NotesShow({ note }: { note: NoteDto }) {
    const remove = () => {
        if (window.confirm('Delete this note?')) {
            router.delete(route('notes.destroy', note.id));
        }
    };

    return (
        <>
            <Head title={note.title} />
            <div className="min-h-screen bg-slate-50">
                <header className="bg-white border-b border-slate-200">
                    <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
                        <a href={route('notes.index')} className="text-sm text-indigo-600 hover:underline">
                            ← All notes
                        </a>
                        <div className="flex items-center gap-3">
                            <a href={route('notes.edit', note.id)} className="text-sm text-slate-600 hover:text-slate-900">
                                Edit
                            </a>
                            <button type="button" className="text-sm text-red-600 hover:text-red-500" onClick={remove}>
                                Delete
                            </button>
                        </div>
                    </div>
                </header>

                <main className="max-w-3xl mx-auto px-4 py-8">
                    <article className="bg-white rounded-xl border border-slate-200 p-8">
                        <h1 className="text-2xl font-bold text-slate-900">{note.title}</h1>
                        <p className="mt-1 text-xs text-slate-400">Created {note.created_at}</p>
                        <p className="mt-6 whitespace-pre-line text-slate-700">{note.body || '(no body)'}</p>
                    </article>
                </main>
            </div>
        </>
    );
}
