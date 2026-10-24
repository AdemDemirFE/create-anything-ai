<script setup>
import { Head, useForm } from '@inertiajs/vue3';

const form = useForm({
    name: '',
    email: '',
    password: '',
});

const submit = () => form.post(route('register.store'));
</script>

<template>
    <Head title="Create account" />
    <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div class="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-8">
            <h1 class="text-2xl font-bold text-slate-900">Create account</h1>
            <p class="mt-1 text-sm text-slate-500">
                Already registered?
                <a :href="route('login')" class="text-indigo-600 hover:underline">Log in</a>
            </p>

            <form class="mt-6 space-y-5" @submit.prevent="submit">
                <div>
                    <label for="name" class="block text-sm font-medium text-slate-700">Name</label>
                    <input
                        id="name"
                        v-model="form.name"
                        type="text"
                        required
                        autocomplete="name"
                        class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                        :aria-invalid="Boolean(form.errors.name)"
                        aria-describedby="name-error"
                    />
                    <p v-if="form.errors.name" id="name-error" class="mt-1 text-sm text-red-600">
                        {{ form.errors.name }}
                    </p>
                </div>

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
                        autocomplete="new-password"
                        class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                        :aria-invalid="Boolean(form.errors.password)"
                        aria-describedby="password-error password-hint"
                    />
                    <p id="password-hint" class="mt-1 text-xs text-slate-500">
                        At least 8 characters, with letters and numbers.
                    </p>
                    <p v-if="form.errors.password" id="password-error" class="mt-1 text-sm text-red-600">
                        {{ form.errors.password }}
                    </p>
                </div>

                <button
                    type="submit"
                    :disabled="form.processing"
                    class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
                >
                    <span v-if="form.processing">Creating account…</span>
                    <span v-else>Create account</span>
                </button>
            </form>
        </div>
    </div>
</template>
