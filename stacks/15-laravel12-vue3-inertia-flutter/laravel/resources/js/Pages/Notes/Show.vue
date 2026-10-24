<script setup>
import { Head, router } from '@inertiajs/vue3';

const props = defineProps({
    note: { type: Object, required: true },
});

const remove = () => {
    if (window.confirm('Delete this note?')) {
        router.delete(route('notes.destroy', props.note.id));
    }
};
</script>

<template>
    <Head :title="note.title" />
    <div class="min-h-screen bg-slate-50">
        <header class="bg-white border-b border-slate-200">
            <div class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
                <a :href="route('notes.index')" class="text-sm text-indigo-600 hover:underline">← All notes</a>
                <div class="flex items-center gap-3">
                    <a :href="route('notes.edit', note.id)" class="text-sm text-slate-600 hover:text-slate-900">Edit</a>
                    <button type="button" class="text-sm text-red-600 hover:text-red-500" @click="remove">Delete</button>
                </div>
            </div>
        </header>

        <main class="max-w-3xl mx-auto px-4 py-8">
            <article class="bg-white rounded-xl border border-slate-200 p-8">
                <h1 class="text-2xl font-bold text-slate-900">{{ note.title }}</h1>
                <p class="mt-1 text-xs text-slate-400">
                    Created {{ note.created_at }}
                </p>
                <p class="mt-6 whitespace-pre-line text-slate-700">{{ note.body || '(no body)' }}</p>
            </article>
        </main>
    </div>
</template>
