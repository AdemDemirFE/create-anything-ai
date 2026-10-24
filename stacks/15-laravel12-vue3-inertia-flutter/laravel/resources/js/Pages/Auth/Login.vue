<script setup>
import { Head, useForm } from '@inertiajs/vue3';

const form = useForm({
    email: '',
    password: '',
});

const submit = () => form.post(route('login.store'));
</script>

<template>
    <Head title="Log in" />
    <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div class="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-8">
            <h1 class="text-2xl font-bold text-slate-900">Log in</h1>
            <p class="mt-1 text-sm text-slate-500">
                New here?
                <a :href="route('register')" class="text-indigo-600 hover:underline">Create an account</a>
            </p>

            <div
                v-if="form.errors.email && !form.errors.email.includes('match')"
                class="mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
                role="alert"
            >
                {{ form.errors.email }}
            </div>

            <form class="mt-6 space-y-5" @submit.prevent="submit">
                <div>
                    <label for="email" class="block text-sm font-medium text-slate-700">Email</label>
                    <input
                        id="email"
                        v-model="form.email"
                        type="email"
                        required
                        autocomplete="email"
                        class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                        :aria-invalid="Boolean(form.errors.email)"
                        aria-describedby="email-error"
                    />
                    <p v-if="form.errors.email" id="email-error" class="mt-1 text-sm text-red-600">
                        {{ form.errors.email }}
                    </p>
                </div>

                <div>
                    <label for="password" class="block text-sm font-medium text-slate-700">Password</label>
                    <input
                        id="password"
                        v-model="form.password"
                        type="password"
                        required
                        autocomplete="current-password"
                        class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                        :aria-invalid="Boolean(form.errors.password)"
                        aria-describedby="password-error"
                    />
                    <p v-if="form.errors.password" id="password-error" class="mt-1 text-sm text-red-600">
                        {{ form.errors.password }}
                    </p>
                </div>

                <button
                    type="submit"
                    :disabled="form.processing"
                    class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
                >
                    <span v-if="form.processing">Logging in…</span>
                    <span v-else>Log in</span>
                </button>
            </form>
        </div>
    </div>
</template>
