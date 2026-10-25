<script setup>
import { Head } from '@inertiajs/vue3';
</script>

<template>
    <Head title="Welcome" />
    <div class="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-slate-100 px-4">
        <div class="max-w-xl w-full text-center">
            <h1 class="text-4xl font-bold text-slate-900">Create Anything AI — Stack 15</h1>
            <p class="mt-4 text-lg text-slate-600">
                Laravel 12 + Inertia 2 + Vue 3 reference implementation.
                Server-side routing with an SPA feel: every click is a real
                HTTP request; Inertia swaps the page component without a full
                reload.
            </p>
            <div class="mt-8 flex items-center justify-center gap-4">
                <template v-if="$page.props.auth.user">
                    <a :href="route('dashboard')"
                       class="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500">
                        Go to dashboard
                    </a>
                </template>
                <template v-else>
                    <a :href="route('login')"
                       class="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500">
                        Log in
                    </a>
                    <a :href="route('register')"
                       class="rounded-lg border border-slate-300 px-5 py-2.5 text-slate-700 font-medium hover:bg-white">
                        Create account
                    </a>
                </template>
            </div>
            <p v-if="$page.props.flash?.status" class="mt-6 text-sm rounded-md bg-emerald-50 text-emerald-700 px-4 py-2 inline-block">
                {{ $page.props.flash.status }}
            </p>
        </div>
    </div>
</template>
