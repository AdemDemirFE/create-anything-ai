import { Head, useForm } from '@inertiajs/react';
import { FormEvent } from 'react';

export default function Register() {
    const { data, setData, post, processing, errors } = useForm({
        name: '',
        email: '',
        password: '',
    });

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        post(route('register.store'));
    };

    return (
        <>
            <Head title="Create account" />
            <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
                <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-8">
                    <h1 className="text-2xl font-bold text-slate-900">Create account</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        Already registered?{' '}
                        <a href={route('login')} className="text-indigo-600 hover:underline">
                            Log in
                        </a>
                    </p>

                    <form className="mt-6 space-y-5" onSubmit={submit}>
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-slate-700">
                                Name
                            </label>
                            <input
                                id="name"
                                type="text"
                                required
                                autoComplete="name"
                                value={data.name}
                                onChange={(e) => setData('name', e.target.value)}
                                className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                                aria-invalid={Boolean(errors.name)}
                                aria-describedby="name-error"
                            />
                            {errors.name && (
                                <p id="name-error" className="mt-1 text-sm text-red-600">
                                    {errors.name}
                                </p>
                            )}
                        </div>

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
                                autoComplete="new-password"
                                value={data.password}
                                onChange={(e) => setData('password', e.target.value)}
                                className="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                                aria-invalid={Boolean(errors.password)}
                                aria-describedby="password-hint password-error"
                            />
                            <p id="password-hint" className="mt-1 text-xs text-slate-500">
                                At least 8 characters, with letters and numbers.
                            </p>
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
                            {processing ? 'Creating account…' : 'Create account'}
                        </button>
                    </form>
                </div>
            </div>
        </>
    );
}
