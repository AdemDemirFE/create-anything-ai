<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Responses\Envelope;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\View\View;

class RegisteredUserController extends Controller
{
    public function create(): View
    {
        return view('auth.register');
    }

    /**
     * Registers a new user. Account-enumeration rule: a duplicate email
     * produces the SAME validation presentation as any other invalid field
     * (field error under "email", no "account exists" wording, no database
     * exception leakage). The unique index at the persistence layer is the
     * real guard (docs/PRODUCT_REQUIREMENTS.md section 6).
     *
     * The email is normalized (trimmed + lowercased) BEFORE validation so
     * the `unique:users,email` rule checks the exact value that will be
     * stored and that login looks up. Without this, "User@X.com" passes the
     * unique check against a stored "user@x.com" on case-sensitive
     * collations, then collides with the DB unique index and surfaces as a
     * 500 instead of the 422 VALIDATION_ERROR envelope.
     */
    public function store(Request $request): RedirectResponse|JsonResponse
    {
        // Normalize first (trim + lowercase), validate second: the unique
        // rule and the persisted value must be the same string.
        $request->merge([
            'email' => mb_strtolower(trim((string) $request->input('email'))),
        ]);

        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', Password::min(8)->letters()->numbers()],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'], // already normalized above
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
