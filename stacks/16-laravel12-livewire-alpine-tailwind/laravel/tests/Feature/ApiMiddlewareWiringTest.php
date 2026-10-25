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
 * real php -S server in the Stack 15 lineage), /api/v1 POSTs placed in
 * routes/web.php were rejected with HTTP 419 CSRF_TOKEN_MISMATCH; the
 * PHPUnit suite did not catch it because
 * ValidateCsrfToken::runningUnitTests() bypasses token verification in every
 * phpunit request. This test fails if the routes ever drift back.
 *
 * Stack 16 addition: Livewire's own update endpoint (`/livewire/update`,
 * auto-registered by the Livewire service provider) must stay IN the web
 * group — it carries the component-state updates for the Blade/Livewire
 * pages and therefore NEEDS the CSRF token. Together the two assertions pin
 * the split: JSON API without CSRF, Livewire updates with CSRF.
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

    public function test_web_group_still_enforces_csrf_for_blade_pages(): void
    {
        $route = Route::getRoutes()->getByName('register.store');

        $this->assertNotNull($route, 'Web register route must exist.');
        $this->assertContains(
            ValidateCsrfToken::class,
            $this->expandedStack($route),
            'Blade form posts must keep CSRF protection.'
        );
    }

    public function test_livewire_update_endpoint_runs_in_the_web_group_with_csrf(): void
    {
        // Livewire 3 registers its update endpoint under a default-named
        // route; find it by URI so the test survives naming changes.
        $route = Route::getRoutes()->getByName('livewire.update')
            ?? Route::getRoutes()->getByName('default.livewire.update')
            ?? collect(Route::getRoutes()->getRoutes())->first(
                fn ($r) => $r->uri() === 'livewire/update' && in_array('POST', $r->methods(), true),
            );

        $this->assertNotNull($route, 'Livewire update endpoint must be registered.');

        $stack = $this->expandedStack($route);

        $this->assertContains(
            ValidateCsrfToken::class,
            $stack,
            'Livewire component updates travel through the web group and MUST keep CSRF protection.'
        );

        $routeMiddleware = $route->middleware();
        $this->assertContains(
            'web',
            $routeMiddleware,
            'livewire/update must be inside the web middleware group (Livewire default), not the api group.'
        );
    }

    public function test_no_api_v1_route_leaks_into_the_web_group(): void
    {
        // The CSRF-419 lesson as a whole-file sweep: not a single /api/v1
        // route may live outside the api group. Routes declare ['api'] or
        // ['api', 'auth']; any 'web' in the expanded stack would mean the
        // CSRF middleware guards them (419 for native clients).
        $leaks = [];

        $this->app->make(\Illuminate\Contracts\Http\Kernel::class);

        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'api/v1')) {
                continue;
            }

            $expanded = array_map(
                fn ($item) => is_string($item) && str_contains($item, ':') ? strtok($item, ':') : $item,
                $this->app['router']->gatherRouteMiddleware($route),
            );

            $declaresApiGroup = in_array('api', $route->middleware(), true);
            $hasCsrf = in_array(ValidateCsrfToken::class, $expanded, true);

            if (! $declaresApiGroup || $hasCsrf) {
                $leaks[] = $route->uri();
            }
        }

        $this->assertSame([], $leaks, '/api/v1 routes found outside the api group: '.implode(', ', $leaks));
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
