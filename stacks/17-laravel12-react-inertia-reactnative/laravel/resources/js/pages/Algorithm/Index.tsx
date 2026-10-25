import { Head, useForm, usePage } from '@inertiajs/react';
import { FormEvent } from 'react';
import type { AlgorithmInfo, AlgorithmRunResult } from '../../types';

interface WorkbenchProps {
    catalog: AlgorithmInfo[];
    maxInputLength: number;
}

export default function AlgorithmIndex({ catalog, maxInputLength }: WorkbenchProps) {
    const { data, setData, post, processing, errors } = useForm({
        algorithmId: '',
        input: '',
    });

    const run = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        post(route('algorithm.run'), {
            preserveState: true,
            preserveScroll: true,
        });
    };

    const result = useResult();

    return (
        <>
            <Head title="Algorithm workbench" />
            <div className="min-h-screen bg-slate-50">
                <header className="bg-white border-b border-slate-200">
                    <div className="max-w-3xl mx-auto px-4 py-4">
                        <a href={route('dashboard')} className="text-sm text-indigo-600 hover:underline">
                            ← Dashboard
                        </a>
                    </div>
                </header>

                <main className="max-w-3xl mx-auto px-4 py-8">
                    <h1 className="text-2xl font-bold text-slate-900">Algorithm workbench</h1>
                    <p className="mt-2 text-sm text-slate-600">
                        Fixed catalog only — your input is processed as data, never executed as code. Measured
                        duration and theoretical complexity are shown separately.
                    </p>

                    <form className="mt-6 bg-white rounded-xl border border-slate-200 p-8 space-y-5" onSubmit={run}>
                        <div>
                            <label htmlFor="algorithmId" className="block text-sm font-medium text-slate-700">
                                Algorithm
                            </label>
                            <select
                                id="algorithmId"
                                required
                                value={data.algorithmId}
                                onChange={(e) => setData('algorithmId', e.target.value)}
                                className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                            >
                                <option value="" disabled>
                                    Select an algorithm…
                                </option>
                                {catalog.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.label} ({item.complexity})
                                    </option>
                                ))}
                            </select>
                            {errors.algorithmId && (
                                <p className="mt-1 text-sm text-red-600">{errors.algorithmId}</p>
                            )}
                        </div>

                        <div>
                            <label htmlFor="input" className="block text-sm font-medium text-slate-700">
                                Input
                            </label>
                            <textarea
                                id="input"
                                rows={4}
                                required
                                maxLength={maxInputLength}
                                value={data.input}
                                onChange={(e) => setData('input', e.target.value)}
                                className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                                aria-describedby="input-hint"
                            />
                            <p id="input-hint" className="mt-1 text-xs text-slate-500">
                                Up to {maxInputLength.toLocaleString()} characters. Oversized input is rejected, never
                                truncated.
                            </p>
                            {errors.input && <p className="mt-1 text-sm text-red-600">{errors.input}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={processing}
                            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
                        >
                            {processing ? 'Running…' : 'Run'}
                        </button>
                    </form>

                    {result !== null && (
                        <section className="mt-6 bg-white rounded-xl border border-slate-200 p-8" aria-live="polite">
                            <h2 className="text-lg font-semibold text-slate-900">Result</h2>
                            <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-800 bg-slate-50 rounded-lg p-4 border border-slate-100">
                                {result.output}
                            </pre>
                            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div>
                                    <dt className="text-slate-500">Measured duration</dt>
                                    <dd className="font-medium text-slate-900">{result.execution_ms} ms</dd>
                                </div>
                                <div>
                                    <dt className="text-slate-500">Theoretical complexity</dt>
                                    <dd className="font-medium text-slate-900">{result.complexity}</dd>
                                </div>
                            </dl>
                            <p className="mt-3 text-xs text-slate-500">{result.explanation}</p>
                        </section>
                    )}
                </main>
            </div>
        </>
    );
}

/**
 * The Inertia flash bag carries the workbench result across the redirect
 * (`with('result', ...)`, see AlgorithmController::runInertia). Reading it
 * through usePage keeps the page a pure Inertia citizen — no separate API
 * call for the web flow.
 */
function useResult(): AlgorithmRunResult | null {
    const props = usePage().props;
    const result = props.result as AlgorithmRunResult | null | undefined;
    return result ?? null;
}
