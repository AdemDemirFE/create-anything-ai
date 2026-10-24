<script setup>
import { Head, router } from '@inertiajs/vue3';

defineProps({
    metrics: { type: Array, default: () => [] },
    recentNotes: { type: Array, default: () => [] },
});

const logout = () => router.post(route('logout'));
</script>

<template>
    <Head title="Dashboard" />
    <div class="min-h-screen bg-slate-50">
        <header class="bg-white border-b border-slate-200">
            <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                <div>
                    <p class="text-sm text-slate-500">Signed in as</p>
                    <p class="font-medium text-slate-900">{{ $page.props.auth.user?.name }}</p>
                </div>
                <nav class="flex items-center gap-4">
                    <a :href="route('notes.index')" class="text-sm text-slate-600 hover:text-slate-900">Notes</a>
                    <a :href="route('algorithm.index')" class="text-sm text-slate-600 hover:text-slate-900">Workbench</a>
                    <button
                        type="button"
                        class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                        @click="logout"
                    >
                        Log out
                    </button>
                </nav>
            </div>
        </header>

        <main class="max-w-5xl mx-auto px-4 py-8">
            <h1 class="text-2xl font-bold text-slate-900">Dashboard</h1>

            <section class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Sample metrics">
                <div
                    v-for="metric in metrics"
                    :key="metric.label"
                    class="bg-white rounded-xl border border-slate-200 p-6"
                >
                    <p class="text-sm text-slate-500">{{ metric.label }}</p>
                    <p class="mt-1 text-3xl font-semibold text-slate-900">{{ metric.value }}</p>
                </div>
            </section>

            <section class="mt-8">
                <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-slate-900">Recent notes</h2>
                    <a :href="route('notes.create')"
                       class="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white font-medium hover:bg-indigo-500">
                        New note
                    </a>
                </div>

                <p v-if="recentNotes.length === 0" class="mt-4 text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
                    No notes yet — create your first one.
                </p>
                <ul v-else class="mt-4 divide-y divide-slate-100 bg-white rounded-xl border border-slate-200">
                    <li v-for="note in recentNotes" :key="note.id" class="px-6 py-4">
                        <a :href="route('notes.show', note.id)" class="font-medium text-slate-900 hover:text-indigo-600">
                            {{ note.title }}
                        </a>
                    </li>
                </ul>
            </section>
        </main>
    </div>
</template>
