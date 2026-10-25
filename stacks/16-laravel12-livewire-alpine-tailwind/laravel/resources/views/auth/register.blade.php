<x-app-layout>
    <div class="mx-auto max-w-md space-y-6">
        <h1 class="text-2xl font-bold">Create your account</h1>

        <form method="POST" action="{{ route('register.store') }}" class="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
            @csrf
            <div>
                <label for="name" class="block text-sm font-medium text-slate-700">Name</label>
                <input id="name" name="name" type="text" value="{{ old('name') }}" required minlength="2" maxlength="255"
                       class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                       aria-describedby="name-error">
                @error('name') <p id="name-error" class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
            </div>
            <div>
                <label for="email" class="block text-sm font-medium text-slate-700">Email</label>
                <input id="email" name="email" type="email" value="{{ old('email') }}" required
                       class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                       aria-describedby="email-error">
                @error('email') <p id="email-error" class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
            </div>
            <div>
                <label for="password" class="block text-sm font-medium text-slate-700">Password</label>
                <input id="password" name="password" type="password" required minlength="8"
                       class="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
                       aria-describedby="password-hint password-error">
                <p id="password-hint" class="mt-1 text-xs text-slate-500">At least 8 characters with letters and numbers.</p>
                @error('password') <p id="password-error" class="mt-1 text-sm text-red-600">{{ $message }}</p> @enderror
            </div>
            <button type="submit" class="w-full rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">Register</button>
        </form>

        <p class="text-sm text-slate-600">
            Already have an account? <a href="{{ route('login') }}" class="font-medium underline">Log in</a>
        </p>
    </div>
</x-app-layout>
