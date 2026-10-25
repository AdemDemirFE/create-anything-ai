<div class="space-y-6">
    <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Notes</h1>
        <a href="{{ route('notes.create') }}" class="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">New note</a>
    </div>

    <div>
        <label for="note-search" class="sr-only">Filter notes</label>
        <input id="note-search" type="search" wire:model.live.debounce.300ms="search" placeholder="Filter by title or body…"
               class="w-full max-w-sm rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none">
    </div>

    <div wire:loading.delay class="text-sm text-slate-500">Updating list…</div>

    @if ($this->notes->isEmpty())
        <p class="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
            @if ($search !== '')
                No notes match “{{ $search }}”.
            @else
                No notes yet. <a href="{{ route('notes.create') }}" class="underline">Create one.</a>
            @endif
        </p>
    @else
        <ul class="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            @foreach ($this->notes as $note)
                <li class="flex items-center justify-between gap-4 px-4 py-3">
                    <div class="min-w-0">
                        <a href="{{ route('notes.show', $note) }}" class="font-medium hover:underline">{{ $note->title }}</a>
                        <p class="truncate text-sm text-slate-500">{{ Str::limit($note->body ?? '', 120) }}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                        @if (in_array($note->id, $pendingDeletes))
                            <span class="text-sm text-red-600">Delete?</span>
                            <button type="button" wire:click="delete({{ $note->id }})"
                                    class="rounded bg-red-600 px-2 py-1 text-sm text-white hover:bg-red-500">Confirm</button>
                            <button type="button" wire:click="cancelDelete({{ $note->id }})"
                                    class="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100">Keep</button>
                        @else
                            <button type="button" wire:click="confirmDelete({{ $note->id }})"
                                    class="rounded border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50">Delete</button>
                        @endif
                    </div>
                </li>
            @endforeach
        </ul>
    @endif
</div>
