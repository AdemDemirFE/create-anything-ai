import { Head, router } from '@inertiajs/react';
import type { NoteDto } from '../../types';

interface NotesIndexProps {
    notes: NoteDto[];
    /** Bounded-list pagination props (review follow-up; server-controlled). */
    page?: number;
    limit?: number;
}

export default function NotesIndex({ notes, page = 1, limit }: NotesIndexProps) {
    const remove = (id: number) => {
        if (window.confirm('Delete this note?')) {
            router.delete(route('notes.destroy', id));
        }
    };

    return (
        <>
            <Head title="Notes" />
            <div className="min-h-screen bg-slate-50">
                <header className="bg-white border-b border-slate-200">
                    <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                        <a href={route('dashboard')} className="text-sm text-indigo-600 hover:underline">
                            ← Dashboard
                        </a>
                        <a
                            href={route('notes.create')}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white font-medium hover:bg-indigo-500"
                        >
                            New note
                        </a>
                    </div>
                </header>

                <main className="max-w-5xl mx-auto px-4 py-8">
                    <h1 className="text-2xl font-bold text-slate-900">Your notes</h1>

                    {notes.length === 0 ? (
                        <p className="mt-4 text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
                            Nothing here yet — create your first note.
                        </p>
                    ) : (
                        <ul className="mt-4 divide-y divide-slate-100 bg-white rounded-xl border border-slate-200">
                            {notes.map((note) => (
                                <li key={note.id} className="px-6 py-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <a
                                            href={route('notes.show', note.id)}
                                            className="font-medium text-slate-900 hover:text-indigo-600"
                                        >
                                            {note.title}
                                        </a>
                                        <p className="text-sm text-slate-500 truncate">{note.body || '(no body)'}</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <a
                                            href={route('notes.edit', note.id)}
                                            className="text-sm text-slate-600 hover:text-slate-900"
                                        >
                                            Edit
                                        </a>
                                        <button
                                            type="button"
                                            className="text-sm text-red-600 hover:text-red-500"
                                            onClick={() => remove(note.id)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Bounded list (review follow-up): the server caps the page at
                        `limit` notes; when the page is exactly full, offer the next
                        slice. The list is newest-first, so older notes sit on page 2+. */}
                    {limit !== undefined && notes.length >= limit && (
                        <div className="mt-4 flex justify-end">
                            <a
                                href={route('notes.index', { page: page + 1 })}
                                className="text-sm text-indigo-600 hover:underline"
                            >
                                Older notes →
                            </a>
                        </div>
                    )}
                </main>
            </div>
        </>
    );
}
