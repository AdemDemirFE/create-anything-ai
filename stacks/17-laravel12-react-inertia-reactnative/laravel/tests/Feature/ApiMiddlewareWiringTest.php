<?php

namespace Tests\Feature;

use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Pins the /api/v1 middleware wiring (regression guard).
 *
 * The JSON API MUST run in the custom `api` middleware group defined in
 * bootstrap/app.php — mounted via withRouting(api: routes/api.php) — NOT in
 * the `web` group. During runtime verification (scripts/smoke.mjs against a
 * real php -S server), /api/v1 POSTs placed in routes/web.php were rejected
 * with HTTP 419 CSRF_TOKEN_MISMATCH; the PHPUnit suite did not catch it
 * because ValidateCsrfToken::runningUnitTests() bypasses token verification
 * in every phpunit request. This test fails if the routes ever drift back.
 */
class ApiMiddlewareWiringTest extends TestCase
{
    public function test_api_v1_routes_run_in_the_api_group_without_csrf(): void
    {
        $route = Route::getRoutes()->getByName('api.register');

        $this->assertNotNull($route, 'Route api.register must exist (mounted from routes/api.php).');
        $this->assertSame(
            ['api'],
            $route->middleware(),
            '/api/v1 routes must be in the api group only, never the web group.'
        );
        $this->assertNotContains(
            ValidateCsrfToken::class,
            $this->expandedStack($route),
            'ValidateCsrfToken must not guard /api/v1 — native clients cannot run the CSRF dance.'
        );
        $this->assertContains(
            ThrottleRequests::class,
            $this->expandedStack($route),
            'throttle:api must guard /api/v1 (coarse infrastructure limiter).'
        );
    }

    public function test_write_api_routes_exist_and_are_post_or_put_or_delete(): void
    {
        foreach (['api.login', 'api.logout', 'api.notes.store', 'api.notes.update', 'api.notes.destroy', 'api.algorithm.run'] as $name) {
            $route = Route::getRoutes()->getByName($name);

            $this->assertNotNull($route, "Route {$name} must exist.");
            $this->assertContains(
                $route->methods()[0],
                ['POST', 'PUT', 'DELETE'],
                "Route {$name} must be a write route."
            );
        }
    }

    public function test_web_group_still_enforces_csrf_for_inertia_pages(): void
    {
        $route = Route::getRoutes()->getByName('register.store');

        $this->assertNotNull($route, 'Web register route must exist.');
        $this->assertContains(
            ValidateCsrfToken::class,
            $this->expandedStack($route),
            'Inertia form posts (React pages) must keep CSRF protection.'
        );
    }

    /**
     * Resolves the route's full middleware stack (group aliases expanded)
     * so assertions cannot be fooled by aliasing.
     *
     * @param  \Illuminate\Routing\Route  $route
     * @return array<int, mixed>
     */
    private function expandedStack($route): array
    {
        // Resolving the HTTP kernel syncs the middleware groups registered
        // in bootstrap/app.php onto the router; without this a test that
        // only inspects routes would see an empty group map.
        $this->app->make(\Illuminate\Contracts\Http\Kernel::class);

        $resolved = [];

        // gatherRouteMiddleware() expands group aliases ("api", "web") into
        // the concrete middleware list exactly as the kernel would when the
        // route is dispatched.
        foreach ($this->app['router']->gatherRouteMiddleware($route) as $item) {
            $resolved[] = is_string($item) && str_contains($item, ':')
                ? strtok($item, ':')
                : $item;
        }

        return $resolved;
    }
}
