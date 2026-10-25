<?php

namespace Tests\Feature;

use Illuminate\Cache\RateLimiter as CacheRateLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Contract test for the COARSE throttle:api limiter on /api/v1 (distinct
 * from the strict failed-login limiter covered by LoginThrottleTest).
 *
 * Pins the full wire behaviour of an exhausted throttle:api budget over the
 * real /api/v1 surface:
 *   - HTTP status 429,
 *   - envelope error code RATE_LIMITED — never the generic HTTP_429 that the
 *     default HttpException fallback would produce. This is a regression
 *     guard for the bootstrap/app.php renderer wiring: the specialised
 *     ThrottleRequestsException renderer must (1) reference the REAL
 *     exception class (Illuminate\Http\Exceptions\ThrottleRequestsException;
 *     a wrong import silently degrades every 429 to HTTP_429 because the
 *     closure's parameter type then never matches) and (2) be registered
 *     BEFORE the generic Symfony HttpException renderer, because render
 *     callbacks are tried in registration order and
 *     ThrottleRequestsException IS a Symfony HttpException subclass.
 *   - Retry-After header carried from the limiter.
 */
class ApiThrottleContractTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Must mirror the Limit::perMinute(240) registered for the named `api`
     * limiter in AppServiceProvider::boot(). It is deliberately pinned here:
     * changing the limiter budget is a contract change and this test should
     * fail until the number is updated in both places.
     */
    private const API_LIMITER_MAX_ATTEMPTS = 240;

    /**
     * Trips the REAL throttle:api middleware by exhausting the named
     * limiter's counter in the cache, then hitting a /api/v1 route. No
     * route or middleware mocking that could bypass the middleware stack.
     */
    private function tripThrottle(): \Illuminate\Testing\TestResponse
    {
        // The limiter closure in AppServiceProvider keys by user id or IP;
        // under PHPUnit the health request is unauthenticated from 127.0.0.1,
        // so limit key = the IP. ThrottleRequests stores named-limiter
        // counters as md5(<limiterName>.<limitKey>) => md5('api127.0.0.1').
        // Hitting exactly this bucket exhausts the budget the next request
        // will consult.
        $rateLimiter = $this->app->make(CacheRateLimiter::class);
        $key = md5('api127.0.0.1');

        for ($i = 0; $i < self::API_LIMITER_MAX_ATTEMPTS; $i++) {
            $rateLimiter->hit($key);
        }

        return $this->getJson('/api/v1/health');
    }

    public function test_exhausted_throttle_api_returns_429_with_rate_limited_envelope(): void
    {
        $response = $this->tripThrottle();

        $response->assertStatus(429);

        $body = $response->json();

        $this->assertFalse($body['ok']);
        $this->assertNull($body['data']);
        $this->assertSame('RATE_LIMITED', $body['error']['code']);
        $this->assertNotSame('HTTP_429', $body['error']['code'], 'A throttle:api 429 must use the specialised renderer, not the generic HttpException fallback.');

        $retryAfter = $response->headers->get('Retry-After');
        $this->assertNotNull($retryAfter, 'A throttled request must carry Retry-After.');
        $this->assertGreaterThanOrEqual(1, (int) $retryAfter);
        $this->assertLessThanOrEqual(60, (int) $retryAfter);
    }

    public function test_throttle_api_recovery_after_the_window_allows_requests_again(): void
    {
        $this->tripThrottle()->assertStatus(429);

        // Clearing the limiter bucket (as the expiry would) must restore
        // access immediately — proves the 429 really came from the
        // throttle:api counter and not from some unrelated failure.
        $rateLimiter = $this->app->make(CacheRateLimiter::class);
        $rateLimiter->clear(md5('api127.0.0.1'));

        $this->getJson('/api/v1/health')->assertOk();
    }

    /**
     * Review follow-up (per-IP auth throttle, `throttle:auth-ip` on the
     * register/login routes): exhausting the PER-IP budget 429s the next
     * register POST from the same address with the RATE_LIMITED envelope +
     * Retry-After — even with VALID credentials. This bounds bulk account
     * creation / credential stuffing from one address independently of the
     * strict email+IP failed-login limiter (which only counts failures).
     *
     * The limiter key mirrors Limit::perMinute($limit)->by($request->ip()):
     * named limiter "auth-ip" keyed on the request IP (127.0.0.1 under
     * phpunit), stored as md5('<name><decay><key>') by
     * RateLimiter::tooManyAttempts — resolved here against the SAME
     * config values AppServiceProvider reads, so the test stays in sync
     * with the registered budget.
     */
    public function test_exhausted_per_ip_auth_throttle_returns_429_with_rate_limited_envelope(): void
    {
        $limit = max(1, (int) config('stack.auth_ip_throttle_limit', 30));
        $rateLimiter = $this->app->make(CacheRateLimiter::class);

        // Exhaust the per-IP bucket exactly as ThrottleRequests would:
        // named limiter "auth-ip" keyed by the request IP, cached as
        // md5($limiterName.$limit->key) — see ThrottleRequests::
        // handleRequestUsingNamedLimiter. perMinute() fixes the window at
        // 60s.
        $key = md5('auth-ip127.0.0.1');
        for ($i = 0; $i < $limit; $i++) {
            $rateLimiter->hit($key, 60);
        }

        $response = $this->postJson('/api/v1/register', [
            'name' => 'Throttle Probe',
            'email' => 'auth-ip-throttle@example.com',
            'password' => 'correcthorse1',
        ]);

        $response->assertStatus(429);
        $body = $response->json();
        $this->assertFalse($body['ok']);
        $this->assertSame('RATE_LIMITED', $body['error']['code']);

        $retryAfter = $response->headers->get('Retry-After');
        $this->assertNotNull($retryAfter, 'A per-IP throttled request must carry Retry-After.');
        $this->assertGreaterThanOrEqual(1, (int) $retryAfter);

        // And nothing was persisted — the request never reached the controller.
        $this->assertDatabaseMissing('users', ['email' => 'auth-ip-throttle@example.com']);
    }

    /**
     * The per-IP limiter must NOT strangle normal use: after the bucket
     * clears (as the decay window would), register works again — proving
     * the 429 came from the auth-ip counter and not from something else.
     */
    public function test_per_ip_auth_throttle_recovers_after_the_window(): void
    {
        $rateLimiter = $this->app->make(CacheRateLimiter::class);
        $key = md5('auth-ip127.0.0.1');

        $limit = max(1, (int) config('stack.auth_ip_throttle_limit', 30));
        for ($i = 0; $i < $limit; $i++) {
            $rateLimiter->hit($key, 60);
        }

        $this->postJson('/api/v1/register', [
            'name' => 'Window Probe',
            'email' => 'window-probe@example.com',
            'password' => 'correcthorse1',
        ])->assertStatus(429);

        $rateLimiter->clear($key);

        $this->postJson('/api/v1/register', [
            'name' => 'Window Probe',
            'email' => 'window-probe@example.com',
            'password' => 'correcthorse1',
        ])->assertStatus(201);
    }
}
