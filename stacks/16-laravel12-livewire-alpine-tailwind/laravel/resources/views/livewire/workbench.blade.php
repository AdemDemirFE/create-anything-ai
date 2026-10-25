<div class="mx-auto max-w-2xl space-y-6">
    <h1 class="text-2xl font-bold">Algorithm workbench</h1>
    <p class="text-sm text-slate-600">
        Fixed catalog only — input is data, never executed. Input is bounded at
        {{ number_format($this->maxInputLength) }} characters; duration is measured, complexity is static.
    </p>

    <div class="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <div>
            <label for="algorithm" class="block text-sm font-medium text-slate-700">Algorithm</label>
            <select id="algorithm" wire:model.blur="algorithmId"
                    class="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-slate-500 focus:outline-none">
                @foreach ($this->catalog as $entry)
                    <option value="{{ $entry['id'] }}">{{ $entry['label'] }} ({{ $entry['complexity'] }})</option>
                @endforeach
            </select>
            @error('algorithmId') <p class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
        </div>

        <div x-data="{ focused: false }">
            <div class="flex items-center justify-between">
                <label for="algorithm-input" class="block text-sm font-medium text-slate-700">Input</label>
                <span class="text-xs text-slate-400" x-text="focused ? 'measuring…' : 'max ' + {{ $this->maxInputLength }} + ' chars'"></span>
            </div>
            <textarea id="algorithm-input" wire:model="input" rows="6"
                      x-on:focus="focused = true" x-on:blur="focused = false"
                      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm focus:border-slate-500 focus:outline-none"></textarea>
            @error('input') <p class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
        </div>

        <button type="button" wire:click="run"
                class="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">Run</button>
        <span wire:loading.delay class="ml-2 text-sm text-slate-500">Running…</span>
    </div>

    @if ($result !== null)
        <div class="space-y-2 rounded-lg border border-slate-200 bg-white p-6">
            <h2 class="font-semibold">Result</h2>
            <pre class="overflow-x-auto rounded bg-slate-900 p-4 font-mono text-sm text-slate-100">{{ $result['output'] }}</pre>
            <p class="text-sm text-slate-600">
                Measured <strong>{{ $result['execution_ms'] }} ms</strong>
                <span class="mx-1 text-slate-300">|</span>
                Static complexity <strong>{{ $result['complexity'] }}</strong>
            </p>
            <p class="text-sm text-slate-500">{{ $result['explanation'] }}</p>
        </div>
    @endif
</div>
