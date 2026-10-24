<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Responses\Envelope;
use App\Models\User;
use App\Services\LoginRateLimiter;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rules\Password;
use Inertia\Inertia;
use Inertia\Response;

class RegisteredUserController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('Auth/Register');
    }

    /**
     * Registers a new user. Account-enumeration rule: a duplicate email
     * produces the SAME validation presentation as any other invalid field
     * (field error under "email", no "account exists" wording, no database
     * exception leakage). The unique index at the persistence layer is the
     * real guard (docs/PRODUCT_REQUIREMENTS.md section 6).
     */
    public function store(Request $request): RedirectResponse|JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', Password::min(8)->letters()->numbers()],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => mb_strtolower($data['email']),
            'password' => Hash::make($data['password']), // bcrypt, salted per user
        ]);

        event(new Registered($user));

        Auth::login($user);
        $request->session()->regenerate(); // session-fixation defense

        if ($request->is('api/*')) {
            return Envelope::ok($request, ['user' => $user->only(['id', 'name', 'email'])], 201);
        }

        return redirect()->intended(route('dashboard'));
    }
}
