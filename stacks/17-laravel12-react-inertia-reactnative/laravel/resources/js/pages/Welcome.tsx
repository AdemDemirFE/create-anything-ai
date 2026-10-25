import { Head } from '@inertiajs/react';
import { usePage } from '@inertiajs/react';
import type { PageProps } from '../types';

export default function Welcome() {
    const { auth, flash } = usePage<PageProps>().props;

    return (
        <>
            <Head title="Welcome" />
            <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 px-4">
                <div className="max-w-xl w-full text-center">
                    <h1 className="text-4xl font-bold text-slate-900">Create Anything AI — Stack 17</h1>
                    <p className="mt-4 text-lg text-slate-600">
                        Laravel 12 + Inertia 2 + React (TypeScript) reference
                        implementation. Server-side routing with an SPA feel:
                        every click is a real HTTP request; Inertia swaps the
                        page component without a full reload.
                    </p>
                    <div className="mt-8 flex items-center justify-center gap-4">
                        {auth.user ? (
                            <a
                                href={route('dashboard')}
                                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500"
                            >
                                Go to dashboard
                            </a>
                        ) : (
                            <>
                                <a
                                    href={route('login')}
                                    className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500"
                                >
                                    Log in
                                </a>
                                <a
                                    href={route('register')}
                                    className="rounded-lg border border-slate-300 px-5 py-2.5 text-slate-700 font-medium hover:bg-white"
                                >
                                    Create account
                                </a>
                            </>
                        )}
                    </div>
                    {flash?.status && (
                        <p className="mt-6 text-sm rounded-md bg-emerald-50 text-emerald-700 px-4 py-2 inline-block">
                            {flash.status}
                        </p>
                    )}
                </div>
            </div>
        </>
    );
}
