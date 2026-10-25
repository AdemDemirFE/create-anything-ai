<div class="mx-auto max-w-2xl space-y-6">
    <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">{{ $note->title }}</h1>
        <a href="{{ route('notes.index') }}" class="text-sm underline">Back to notes</a>
    </div>

    <div class="rounded-lg border border-slate-200 bg-white p-6">
        @if (!$editing)
            <p class="whitespace-pre-wrap">{{ $note->body ?? '(empty body)' }}</p>
            <p class="mt-4 text-xs text-slate-400">
                Created {{ $note->created_at?->toDateTimeString() }} ·
                Updated {{ $note->updated_at?->toDateTimeString() }}
            </p>
            <div class="mt-6 flex gap-2">
                <button type="button" wire:click="startEdit" class="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Edit</button>
                <button type="button" wire:click="delete" wire:confirm="Delete this note?"
                        class="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">Delete</button>
            </div>
        @else
            <div class="space-y-4">
                <div>
                    <label for="edit-title" class="block text-sm font-medium text-slate-700">Title</label>
                    <input id="edit-title" type="text" wire:model="title"
                           class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none">
                    @error('title') <p class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="edit-body" class="block text-sm font-medium text-slate-700">Body</label>
                    <textarea id="edit-body" wire:model="body" rows="8"
                              class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"></textarea>
                    @error('body') <p class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
                </div>
                <div class="flex gap-2">
                    <button type="button" wire:click="save" class="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save</button>
                    <button type="button" wire:click="cancelEdit" class="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">Cancel</button>
                </div>
            </div>
        @endif
    </div>
</div>
