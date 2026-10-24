<script setup>
import { Head, useForm } from '@inertiajs/vue3';

defineProps({
    catalog: { type: Array, required: true },
    maxInputLength: { type: Number, required: true },
});

const form = useForm({
    algorithmId: '',
    input: '',
});

const run = () => form.post(route('algorithm.run'), {
    preserveState: true,
    preserveScroll: true,
});
</script>

<template>
    <Head title="Algorithm workbench" />
    <div class="min-h-screen bg-slate-50">
        <header class="bg-white border-b border-slate-200">
            <div class="max-w-3xl mx-auto px-4 py-4">
                <a :href="route('dashboard')" class="text-sm text-indigo-600 hover:underline">← Dashboard</a>
            </div>
        </header>

        <main class="max-w-3xl mx-auto px-4 py-8">
            <h1 class="text-2xl font-bold text-slate-900">Algorithm workbench</h1>
            <p class="mt-2 text-sm text-slate-600">
                Fixed catalog only — your input is processed as data, never executed as code.
                Measured duration and theoretical complexity are shown separately.
            </p>

            <form class="mt-6 bg-white rounded-xl border border-slate-200 p-8 space-y-5" @submit.prevent="run">
                <div>
                    <label for="algorithmId" class="block text-sm font-medium text-slate-700">Algorithm</label>
                    <select
                        id="algorithmId"
                        v-model="form.algorithmId"
                        required
                        class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                    >
                        <option value="" disabled>Select an algorithm…</option>
                        <option v-for="item in catalog" :key="item.id" :value="item.id">
                            {{ item.label }} ({{ item.complexity }})
                        </option>
                    </select>
                </div>

                <div>
                    <label for="input" class="block text-sm font-medium text-slate-700">Input</label>
                    <textarea
                        id="input"
                        v-model="form.input"
                        rows="4"
                        required
                        :maxlength="maxInputLength"
                        class="mt-1 block w-full rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
                        aria-describedby="input-hint input-error"
                    ></textarea>
                    <p id="input-hint" class="mt-1 text-xs text-slate-500">
                        Up to {{ maxInputLength.toLocaleString() }} characters. For FizzBuzz, a whole number 1–1000.
                    </p>
                    <p v-if="form.errors.input" id="input-error" class="mt-1 text-sm text-red-600">
                        {{ form.errors.input }}
                    </p>
                    <p v-if="form.errors.algorithmId" class="mt-1 text-sm text-red-600">
                        {{ form.errors.algorithmId }}
                    </p>
                </div>

                <button
                    type="submit"
                    :disabled="form.processing"
                    class="rounded-lg bg-indigo-600 px-5 py-2.5 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
                >
                    <span v-if="form.processing">Running…</span>
                    <span v-else>Run</span>
                </button>
            </form>

            <section v-if="$page.props.flash?.result" class="mt-6 bg-white rounded-xl border border-slate-200 p-8" aria-live="polite">
                <h2 class="text-lg font-semibold text-slate-900">Result</h2>
                <pre class="mt-3 bg-slate-50 rounded-lg p-4 text-sm overflow-x-auto">{{ $page.props.flash.result.output }}</pre>
                <dl class="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <dt class="text-slate-500">Measured duration</dt>
                        <dd class="font-medium text-slate-900">{{ $page.props.flash.result.execution_ms }} ms</dd>
                    </div>
                    <div>
                        <dt class="text-slate-500">Theoretical complexity</dt>
                        <dd class="font-medium text-slate-900">{{ $page.props.flash.result.complexity }}</dd>
                    </div>
                </dl>
                <p class="mt-3 text-xs text-slate-500">{{ $page.props.flash.result.explanation }}</p>
            </section>
        </main>
    </div>
</template>
