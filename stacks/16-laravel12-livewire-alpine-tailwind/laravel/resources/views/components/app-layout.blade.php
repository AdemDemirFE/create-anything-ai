<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">
        <title>{{ $title ?? config('app.name', 'Stack 16') }}</title>

        @vite(['resources/css/app.css', 'resources/js/app.js'])
        @livewireStyles
    </head>
    <body class="font-sans antialiased bg-slate-50 text-slate-900">
        @livewireScripts
        <nav class="border-b border-slate-200 bg-white">
            <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                <a href="{{ route('welcome') }}" class="font-semibold text-slate-900">Stack 16 <span class="text-slate-400">TALL</span></a>
                <div class="flex items-center gap-4 text-sm">
                    @auth
                        <a href="{{ route('dashboard') }}" class="text-slate-600 hover:text-slate-900">Dashboard</a>
                        <a href="{{ route('notes.index') }}" class="text-slate-600 hover:text-slate-900">Notes</a>
                        <a href="{{ route('algorithm.index') }}" class="text-slate-600 hover:text-slate-900">Workbench</a>
                        <form method="POST" action="{{ route('logout') }}" class="inline">
                            @csrf
                            <button type="submit" class="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-100">Log out</button>
                        </form>
                    @else
                        <a href="{{ route('login') }}" class="text-slate-600 hover:text-slate-900">Log in</a>
                        <a href="{{ route('register') }}" class="rounded bg-slate-900 px-3 py-1 text-white hover:bg-slate-700">Register</a>
                    @endauth
                </div>
            </div>
        </nav>
        <main class="mx-auto max-w-5xl px-4 py-8">
            <div class="mb-6 space-y-2">
                @if (session('status'))
                    <div x-data="{ show: true }" x-show="show" class="rounded border border-emerald-300 bg-emerald-50 px-4 py-2 text-emerald-800" role="status">
                        <span>{{ session('status') }}</span>
                        <button type="button" class="float-right text-emerald-600" x-on:click="show = false" aria-label="Dismiss">×</button>
                    </div>
                @endif
            </div>
            {{ $slot }}
        </main>
    </body>
</html>
