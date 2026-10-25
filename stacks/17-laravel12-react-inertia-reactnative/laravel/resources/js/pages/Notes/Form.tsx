import { Head, useForm } from '@inertiajs/react';
import { FormEvent } from 'react';
import type { NoteDto } from '../../types';

interface FormProps {
    mode: 'create' | 'edit';
    note: NoteDto | null;
}

export default function NotesForm({ mode, note }: FormProps) {
    const { data, setData, post, put, processing, errors } = useForm({
        title: note?.title ?? '',
        body: note?.body ?? '',
    });

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (mode === 'create') {
            post(route('notes.store'));
        } else if (note) {
            put(route('notes.update', note.id));
        }
    };

    return (
        <>
            <Head title={mode === 'create' ? 'New note' : 'Edit note'} />
            <div className="min-h-screen bg-slate-50">
                <header className="bg-white border-b border-slate-200">
                    <div className="max-w-3xl mx-auto px-4 py-4">
                        <a
                            href={mode === 'create' ? route('notes.index') : route('notes.show', note?.id ?? 0)}
                            className="text-sm text-indigo-600 hover:underline"
                        >
                            ← Back
                        </a>
                    </div>
                </header>

                <main className="max-w-3xl mx-auto px-4 py-8">
                    <div className="bg-white rounded-xl border border-slate-200 p-8">
                        <h1 className="text-2xl font-bold text-slate-900">
                            {mode === 'create' ? 'New note' : 'Edit note'}
                        </h1>

                        <form className="mt-6 space-y-5" onSubmit={submit}>
                            <div>
                                <label htmlFor="title" className="block text-sm font-medium text-slate-700">
                                    Title
                                </label>
                                <input
                                    id="title"
                                    type="text"
                                    required
                                    maxLength={120}
                                    value={data.title}
                                    onChange={(e) => setData('title', e.target.value)}
                                    className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                                    aria-invalid={Boolean(errors.title)}
                                    aria-describedby="title-error"
                                />
                                {errors.title && (
                                    <p id="title-error" className="mt-1 text-sm text-red-600">
                                        {errors.title}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label htmlFor="body" className="block text-sm font-medium text-slate-700">
                                    Body
                                </label>
                                <textarea
                                    id="body"
                                    rows={8}
                                    maxLength={5000}
                                    value={data.body ?? ''}
                                    onChange={(e) => setData('body', e.target.value)}
                                    className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                                    aria-invalid={Boolean(errors.body)}
                                    aria-describedby="body-hint body-error"
                                />
                                <p id="body-hint" className="mt-1 text-xs text-slate-500">
                                    Up to 5,000 characters.
                                </p>
                                {errors.body && (
                                    <p id="body-error" className="mt-1 text-sm text-red-600">
                                        {errors.body}
                                    </p>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={processing}
                                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
                            >
                                {processing ? 'Saving…' : mode === 'create' ? 'Create note' : 'Save changes'}
                            </button>
                        </form>
                    </div>
                </main>
            </div>
        </>
    );
}
