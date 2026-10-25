<script setup>
import { Head, useForm } from '@inertiajs/vue3';

const props = defineProps({
    mode: { type: String, required: true }, // 'create' | 'edit'
    note: { type: Object, default: null },
});

const form = useForm({
    title: props.note?.title ?? '',
    body: props.note?.body ?? '',
});

const submit = () => {
    if (props.mode === 'create') {
        form.post(route('notes.store'));
    } else {
        form.put(route('notes.update', props.note.id));
    }
};
</script>

<template>
    <Head :title="mode === 'create' ? 'New note' : 'Edit note'" />
    <div class="min-h-screen bg-slate-50">
        <header class="bg-white border-b border-slate-200">
            <div class="max-w-3xl mx-auto px-4 py-4">
                <a :href="mode === 'create' ? route('notes.index') : route('notes.show', note.id)"
                   class="text-sm text-indigo-600 hover:underline">← Back</a>
            </div>
        </header>

        <main class="max-w-3xl mx-auto px-4 py-8">
            <div class="bg-white rounded-xl border border-slate-200 p-8">
                <h1 class="text-2xl font-bold text-slate-900">
                    {{ mode === 'create' ? 'New note' : 'Edit note' }}
                </h1>

                <form class="mt-6 space-y-5" @submit.prevent="submit">
                    <div>
                        <label for="title" class="block text-sm font-medium text-slate-700">Title</label>
                        <input
                            id="title"
                            v-model="form.title"
                            type="text"
                            required
                            maxlength="120"
                            class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                            :aria-invalid="Boolean(form.errors.title)"
                            aria-describedby="title-error"
                        />
                        <p v-if="form.errors.title" id="title-error" class="mt-1 text-sm text-red-600">
                            {{ form.errors.title }}
                        </p>
                    </div>

                    <div>
                        <label for="body" class="block text-sm font-medium text-slate-700">Body</label>
                        <textarea
                            id="body"
                            v-model="form.body"
                            rows="8"
                            maxlength="5000"
                            class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                            :aria-invalid="Boolean(form.errors.body)"
                            aria-describedby="body-error body-hint"
                        ></textarea>
                        <p id="body-hint" class="mt-1 text-xs text-slate-500">Up to 5,000 characters.</p>
                        <p v-if="form.errors.body" id="body-error" class="mt-1 text-sm text-red-600">
                            {{ form.errors.body }}
                        </p>
                    </div>

                    <button
                        type="submit"
                        :disabled="form.processing"
                        class="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
                    >
                        <span v-if="form.processing">Saving…</span>
                        <span v-else>{{ mode === 'create' ? 'Create note' : 'Save changes' }}</span>
                    </button>
                </form>
            </div>
        </main>
    </div>
</template>
