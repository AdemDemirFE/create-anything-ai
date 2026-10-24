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
    }
}
