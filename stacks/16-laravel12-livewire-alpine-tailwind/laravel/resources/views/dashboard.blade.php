<x-app-layout>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <h1 class="text-2xl font-bold">Dashboard</h1>
            <span class="text-sm text-slate-600">{{ auth()->user()->email }}</span>
        </div>

        <dl class="grid gap-4 sm:grid-cols-2">
            @foreach ($metrics as $metric)
                <div class="rounded-lg border border-slate-200 bg-white p-6">
                    <dt class="text-sm text-slate-500">{{ $metric['label'] }}</dt>
                    <dd class="mt-1 text-2xl font-semibold">{{ $metric['value'] }}</dd>
                </div>
            @endforeach
        </dl>

        <section class="rounded-lg border border-slate-200 bg-white p-6">
            <div class="flex items-center justify-between">
                <h2 class="font-semibold">Recent notes</h2>
                <a href="{{ route('notes.index') }}" class="text-sm font-medium underline">All notes</a>
            </div>
            @if ($recentNotes->isEmpty())
                <p class="mt-3 text-sm text-slate-500">No notes yet. <a href="{{ route('notes.create') }}" class="underline">Create your first one.</a></p>
            @else
                <ul class="mt-3 divide-y divide-slate-100">
                    @foreach ($recentNotes as $note)
                        <li class="py-2">
                            <a href="{{ route('notes.show', $note) }}" class="font-medium hover:underline">{{ $note->title }}</a>
                            <span class="ml-2 text-xs text-slate-400">{{ $note->created_at?->toDateTimeString() }}</span>
                        </li>
                    @endforeach
                </ul>
            @endif
        </section>
    </div>
</x-app-layout>
