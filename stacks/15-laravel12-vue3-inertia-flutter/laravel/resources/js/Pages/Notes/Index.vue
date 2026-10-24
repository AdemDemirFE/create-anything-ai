<script setup>
import { Head, router } from '@inertiajs/vue3';

defineProps({
    notes: { type: Array, default: () => [] },
});

const remove = (id) => {
    if (window.confirm('Delete this note?')) {
        router.delete(route('notes.destroy', id));
    }
};
</script>

<template>
    <Head title="Notes" />
    <div class="min-h-screen bg-slate-50">
        <header class="bg-white border-b border-slate-200">
            <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
                <a :href="route('dashboard')" class="text-sm text-indigo-600 hover:underline">← Dashboard</a>
                <a :href="route('notes.create')"
                   class="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white font-medium hover:bg-indigo-500">
                    New note
                </a>
            </div>
        </header>

        <main class="max-w-5xl mx-auto px-4 py-8">
            <h1 class="text-2xl font-bold text-slate-900">Your notes</h1>

            <p v-if="notes.length === 0" class="mt-4 text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
                Nothing here yet — create your first note.
            </p>
            <ul v-else class="mt-4 divide-y divide-slate-100 bg-white rounded-xl border border-slate-200">
                <li v-for="note in notes" :key="note.id" class="px-6 py-4 flex items-center justify-between gap-4">
                    <div class="min-w-0">
                        <a :href="route('notes.show', note.id)" class="font-medium text-slate-900 hover:text-indigo-600">
                            {{ note.title }}
                        </a>
                        <p class="text-sm text-slate-500 truncate">{{ note.body || '(no body)' }}</p>
                    </div>
                    <div class="flex items-center gap-3 shrink-0">
                        <a :href="route('notes.edit', note.id)" class="text-sm text-slate-600 hover:text-slate-900">Edit</a>
                        <button type="button" class="text-sm text-red-600 hover:text-red-500" @click="remove(note.id)">
                            Delete
                        </button>
                    </div>
                </li>
            </ul>
        </main>
    </div>
</template>
