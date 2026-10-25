<?php

namespace App\Http\Controllers\Auth;

use App\Exceptions\LoginThrottledException;
use App\Http\Controllers\Controller;
use App\Http\Responses\Envelope;
use App\Services\LoginRateLimiter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use App\Models\User;

class AuthenticatedSessionController extends Controller
{
    public function create(): \Inertia\Response
    {
        return Inertia::render('Auth/Login');
    }

    /**
     * Session login for both Inertia pages and /api/v1.
     *
     * - Throttle BEFORE credential check: too many failed attempts return
     *   429 + Retry-After (via ThrottleRequestsException rendering) even for
     *   a correct password — success does NOT bypass the lockout.
     * - Only FAILED attempts hit the limiter; a success clears the tally.
     * - Unknown email and wrong password produce the IDENTICAL generic
     *   INVALID_CREDENTIALS response (no account enumeration).
     * - Passwords/credentials are never logged.
     */
    public function store(Request $request): RedirectResponse|JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'string', 'email:rfc'],
            'password' => ['required', 'string'],
        ]);

        $limiter = app(LoginRateLimiter::class);
        $email = mb_strtolower(trim($credentials['email']));
        $ip = $request->ip() ?? 'unknown';

        if ($limiter->tooManyAttempts($email, $ip)) {
            // Correct passwords do NOT bypass the lockout: the counter is
            // keyed on email+IP, not on credential validity.
            throw LoginThrottledException::for($limiter, $email, $ip);
        }

        /** @var User|null $user */
        $user = User::query()->where('email', $email)->first();

        if ($user === null || ! Hash::check($credentials['password'], $user->password)) {
            $limiter->hit($email, $ip);

            // Burn a verification even when the user is unknown so response
            // timing does not reveal whether the account exists.
            if ($user === null) {
                Hash::check($credentials['password'], User::placeholderHash());
            }

            if ($request->is('api/*')) {
                return Envelope::error(
                    $request,
                    code: 'INVALID_CREDENTIALS',
                    message: 'These credentials do not match our records.',
                    status: 401,
                );
            }

            // Inertia path: back with a single generic error (errors.email).
            throw ValidationException::withMessages([
                'email' => __('These credentials do not match our records.'),
            ]);
        }

        Auth::login($user, remember: false);
        $request->session()->regenerate(); // session-fixation defense
        $limiter->clear($email, $ip);

        if ($request->is('api/*')) {
            return Envelope::ok($request, ['user' => $user->only(['id', 'name', 'email'])]);
        }

        return redirect()->intended(route('dashboard'));
    }

    /**
     * Logout = server-side session invalidation + cookie rotation. The
     * session row is deleted; a stolen old cookie afterwards is worthless.
     */
    public function destroy(Request $request): RedirectResponse|JsonResponse
    {
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        if ($request->is('api/*')) {
            return Envelope::ok($request, ['logged_out' => true]);
        }

        return redirect()->route('welcome')->with('status', 'Logged out.');
    }
}
