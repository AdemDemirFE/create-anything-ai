import { Head, router, usePage } from '@inertiajs/react';
import type { Metric, PageProps } from '../types';

interface DashboardProps extends PageProps {
    metrics: Metric[];
    recentNotes: Array<{ id: number; title: string; created_at: string }>;
}

export default function Dashboard() {
    const { auth } = usePage<PageProps>().props;
    const { metrics, recentNotes } = usePage<DashboardProps>().props;

    const logout = () => router.post(route('logout'));

    return (
        <>
            <Head title="Dashboard" />
            <div className="min-h-screen bg-slate-50">
                <header className="bg-white border-b border-slate-200">
                    <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-500">Signed in as</p>
                            <p className="font-medium text-slate-900">{auth.user?.name}</p>
                        </div>
                        <nav className="flex items-center gap-4">
                            <a href={route('notes.index')} className="text-sm text-slate-600 hover:text-slate-900">
                                Notes
                            </a>
                            <a href={route('algorithm.index')} className="text-sm text-slate-600 hover:text-slate-900">
                                Workbench
                            </a>
                            <button
                                type="button"
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                                onClick={logout}
                            >
                                Log out
                            </button>
                        </nav>
                    </div>
                </header>

                <main className="max-w-5xl mx-auto px-4 py-8">
                    <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

                    <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Sample metrics">
                        {metrics.map((metric) => (
                            <div key={metric.label} className="bg-white rounded-xl border border-slate-200 p-6">
                                <p className="text-sm text-slate-500">{metric.label}</p>
                                <p className="mt-1 text-3xl font-semibold text-slate-900">{metric.value}</p>
                            </div>
                        ))}
                    </section>

                    <section className="mt-8">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-slate-900">Recent notes</h2>
                            <a
                                href={route('notes.create')}
                                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white font-medium hover:bg-indigo-500"
                            >
                                New note
                            </a>
                        </div>

                        {recentNotes.length === 0 ? (
                            <p className="mt-4 text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
                                No notes yet — create your first one.
                            </p>
                        ) : (
                            <ul className="mt-4 divide-y divide-slate-100 bg-white rounded-xl border border-slate-200">
                                {recentNotes.map((note) => (
                                    <li key={note.id} className="px-6 py-4">
                                        <a
                                            href={route('notes.show', note.id)}
                                            className="font-medium text-slate-900 hover:text-indigo-600"
                                        >
                                            {note.title}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </main>
            </div>
        </>
    );
}
