import { Head, useForm } from '@inertiajs/react';
import { FormEvent } from 'react';

const form = {
    email: '',
    password: '',
};

export default function Login() {
    const { data, setData, post, processing, errors } = useForm(form);

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        post(route('login.store'));
    };

    return (
        <>
            <Head title="Log in" />
            <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
                <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-8">
                    <h1 className="text-2xl font-bold text-slate-900">Log in</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        New here?{' '}
                        <a href={route('register')} className="text-indigo-600 hover:underline">
                            Create an account
                        </a>
                    </p>

                    {errors.email && !errors.email.includes('match') && (
                        <div
                            className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
                            role="alert"
                        >
                            {errors.email}
                        </div>
                    )}

                    <form className="mt-6 space-y-5" onSubmit={submit}>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                required
                                autoComplete="email"
                                value={data.email}
                                onChange={(e) => setData('email', e.target.value)}
                                className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                                aria-invalid={Boolean(errors.email)}
                                aria-describedby="email-error"
                            />
                            {errors.email && (
                                <p id="email-error" className="mt-1 text-sm text-red-600">
                                    {errors.email}
                                </p>
                            )}
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                required
                                autoComplete="current-password"
                                value={data.password}
                                onChange={(e) => setData('password', e.target.value)}
                                className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                                aria-invalid={Boolean(errors.password)}
                                aria-describedby="password-error"
                            />
                            {errors.password && (
                                <p id="password-error" className="mt-1 text-sm text-red-600">
                                    {errors.password}
                                </p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={processing}
                            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
                        >
                            {processing ? 'Logging in…' : 'Log in'}
                        </button>
                    </form>
                </div>
            </div>
        </>
    );
}
