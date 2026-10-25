<x-app-layout>
    <section class="space-y-6">
        <div class="rounded-lg border border-slate-200 bg-white p-8">
            <h1 class="text-3xl font-bold">Laravel 12 + Livewire 3 + Alpine 3 + Tailwind 3</h1>
            <p class="mt-3 max-w-2xl text-slate-600">
                Server-rendered reference implementation of the four-screen journey — no SPA.
                Page interactions run through Livewire 3 full-page components (wire:model + actions);
                Alpine adds progressive small-scale UI behavior; Tailwind 3 styles everything.
            </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
            <div class="rounded-lg border border-slate-200 bg-white p-6">
                <h2 class="font-semibold">1 · Register / Login</h2>
                <p class="mt-2 text-sm text-slate-600">Session-cookie auth, throttled login, no account enumeration.</p>
                @guest
                    <div class="mt-4 flex gap-2">
                        <a href="{{ route('register') }}" class="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">Register</a>
                        <a href="{{ route('login') }}" class="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">Log in</a>
                    </div>
                @endguest
            </div>
            <div class="rounded-lg border border-slate-200 bg-white p-6">
                <h2 class="font-semibold">2 · Dashboard + Notes</h2>
                <p class="mt-2 text-sm text-slate-600">Profile metrics plus a full-page Livewire notes list (search, delete).</p>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white p-6">
                <h2 class="font-semibold">3 · Workbench</h2>
                <p class="mt-2 text-sm text-slate-600">Fixed-catalog algorithm runs with bounded input, Livewire-powered.</p>
            </div>
        </div>

        <div class="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <p class="font-semibold text-slate-900">Machine-readable API</p>
            <p class="mt-1">
                <code>/api/v1/health</code> and friends answer with the stack envelope
                <code>{ ok, data, error, requestId }</code> in a dedicated api middleware group
                (no CSRF — the documented CSRF-419 lesson; see ARCHITECTURE.md).
            </p>
        </div>
    </section>
</x-app-layout>
