<div class="mx-auto max-w-2xl space-y-6">
    <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">{{ $noteId === null ? 'New note' : 'Edit note' }}</h1>
        <button type="button" wire:click="cancel" class="text-sm underline">Cancel</button>
    </div>

    <form wire:submit="save" class="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <div>
            <label for="note-title" class="block text-sm font-medium text-slate-700">Title</label>
            <input id="note-title" type="text" wire:model.blur="title" maxlength="120"
                   class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none">
            @error('title') <p class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
        </div>
        <div>
            <div class="flex items-center justify-between">
                <label for="note-body" class="block text-sm font-medium text-slate-700">Body</label>
                <span class="text-xs text-slate-400">{{ $this->bodyLength }} / 5000</span>
            </div>
            <textarea id="note-body" wire:model="body" rows="10"
                      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"></textarea>
            @error('body') <p class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
        </div>
        <div class="flex items-center gap-3">
            <button type="submit" class="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">
                {{ $noteId === null ? 'Create note' : 'Save changes' }}
            </button>
            <span wire:loading.delay class="text-sm text-slate-500">Saving…</span>
        </div>
    </form>
</div>
