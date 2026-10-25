<?php

namespace App\Providers;

use App\Services\LoginRateLimiter;
use Illuminate\Cache\RateLimiter as CacheRateLimiter;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(LoginRateLimiter::class, function ($app) {
            // Named cache store "login-throttle" so operations can point the
            // counter at redis while sessions stay on the database driver.
            return new LoginRateLimiter(
                new CacheRateLimiter($app['cache']->store(config('stack.login_throttle_store')))
            );
        });
    }

    public function boot(): void
    {
        // Coarse infrastructure limiter for the whole /api/v1 surface
        // (`throttle:api` in the custom api middleware group, see
        // bootstrap/app.php). Per-user when authenticated, per-IP otherwise.
        // Generous ceiling: the STRICT failed-login limiter lives in
        // LoginRateLimiter and returns 429 + Retry-After after 5 failed
        // attempts; this one only guards against wholesale abuse.
        RateLimiter::for('api', function (Request $request) {
            return [Limit::perMinute(240)->by($request->user()?->id ?: $request->ip())];
        });

        // Per-IP limiter for the UNAUTHENTICATED auth endpoints
        // (`throttle:auth-ip` on the register/login routes — review
        // follow-up hardening). Keyed on IP only: these requests have no
        // user yet. Bounds credential stuffing and bulk account creation
        // from one address IN ADDITION to the email+IP failed-login
        // limiter (which only counts failures and never 429s a correct
        // login before its own budget). Response is 429 + Retry-After via
        // the ThrottleRequestsException renderer (RATE_LIMITED envelope).
        // Budget configurable via AUTH_IP_THROTTLE_LIMIT (config/stack.php,
        // default 30/min); the window is fixed at 60s via Limit::perMinute.
        $limit = max(1, (int) config('stack.auth_ip_throttle_limit', 30));

        RateLimiter::for('auth-ip', function (Request $request) use ($limit) {
            return [Limit::perMinute($limit)->by($request->ip() ?: 'unknown')];
        });
    }
}
