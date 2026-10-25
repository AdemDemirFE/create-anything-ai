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
}
