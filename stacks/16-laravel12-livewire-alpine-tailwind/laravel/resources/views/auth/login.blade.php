<x-app-layout>
    <div class="mx-auto max-w-md space-y-6">
        <h1 class="text-2xl font-bold">Log in</h1>

        <form method="POST" action="{{ route('login.store') }}" class="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
            @csrf
            <div>
                <label for="email" class="block text-sm font-medium text-slate-700">Email</label>
                <input id="email" name="email" type="email" value="{{ old('email') }}" required
                       class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                       aria-describedby="email-error">
                @error('email') <p id="email-error" class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
            </div>
            <div>
                <label for="password" class="block text-sm font-medium text-slate-700">Password</label>
                <input id="password" name="password" type="password" required
                       class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                       aria-describedby="password-error">
                @error('password') <p id="password-error" class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
            </div>
            <button type="submit" class="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">Log in</button>
        </form>

        <p class="text-sm text-slate-600">
            No account yet? <a href="{{ route('register') }}" class="font-medium underline">Register</a>
        </p>
    </div>
</x-app-layout>
