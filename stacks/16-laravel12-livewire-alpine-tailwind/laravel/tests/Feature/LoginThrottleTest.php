<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Failed-login rate limiter tests: only FAILED attempts consume budget,
 * 429 + Retry-After when exhausted, success clears the tally, and a correct
 * password does NOT bypass the lockout.
 */
class LoginThrottleTest extends TestCase
{
    use RefreshDatabase;

    private const MAX_ATTEMPTS = 5;

    public function test_failed_attempts_then_429_with_retry_after_header(): void
    {
        $user = User::factory()->create(['password' => Hash::make('correcthorse1')]);

        for ($i = 0; $i < self::MAX_ATTEMPTS; $i++) {
            $response = $this->postJson('/api/v1/login', [
                'email' => $user->email,
                'password' => 'wrongpassword1',
            ]);

            $response->assertStatus(401);
        }

        $locked = $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'wrongpassword1',
        ]);

        $locked->assertStatus(429);

        $body = $locked->json();
        $this->assertFalse($body['ok']);
        $this->assertSame('RATE_LIMITED', $body['error']['code']);

        $retryAfter = $locked->headers->get('Retry-After');
        $this->assertNotNull($retryAfter, '429 must carry Retry-After.');
        $this->assertGreaterThanOrEqual(1, (int) $retryAfter);
        $this->assertLessThanOrEqual(60, (int) $retryAfter);
    }

    public function test_correct_password_does_not_bypass_lockout(): void
    {
        $user = User::factory()->create(['password' => Hash::make('correcthorse1')]);

        for ($i = 0; $i < self::MAX_ATTEMPTS; $i++) {
            $this->postJson('/api/v1/login', [
                'email' => $user->email,
                'password' => 'wrongpassword1',
            ])->assertStatus(401);
        }

        $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'correcthorse1', // the RIGHT password, still locked
        ])->assertStatus(429);
    }

    public function test_successful_login_clears_the_tally(): void
    {
        $user = User::factory()->create(['password' => Hash::make('correcthorse1')]);

        // Two failures (below the limit of 5):
        for ($i = 0; $i < 2; $i++) {
            $this->postJson('/api/v1/login', [
                'email' => $user->email,
                'password' => 'wrongpassword1',
            ])->assertStatus(401);
        }

        $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'correcthorse1',
        ])->assertOk();

        // The tally was cleared — MAX full failures are needed again before 429:
        for ($i = 0; $i < self::MAX_ATTEMPTS; $i++) {
            $this->postJson('/api/v1/login', [
                'email' => $user->email,
                'password' => 'wrongpassword1',
            ])->assertStatus(401);
        }

        $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'wrongpassword1',
        ])->assertStatus(429);
    }

    public function test_throttle_is_keyed_on_email_and_ip(): void
    {
        User::factory()->create(['email' => 'a@example.com', 'password' => Hash::make('correcthorse1')]);
        User::factory()->create(['email' => 'b@example.com', 'password' => Hash::make('correcthorse1')]);

        // Exhaust the budget for a@example.com:
        for ($i = 0; $i < self::MAX_ATTEMPTS; $i++) {
            $this->postJson('/api/v1/login', [
                'email' => 'a@example.com',
                'password' => 'wrongpassword1',
            ])->assertStatus(401);
        }

        $this->postJson('/api/v1/login', [
            'email' => 'a@example.com',
            'password' => 'wrongpassword1',
        ])->assertStatus(429);

        // b@example.com from the same IP is unaffected:
        $this->postJson('/api/v1/login', [
            'email' => 'b@example.com',
            'password' => 'wrongpassword1',
        ])->assertStatus(401);
    }

    public function test_blade_login_also_hits_the_limiter(): void
    {
        $user = User::factory()->create(['password' => Hash::make('correcthorse1')]);

        for ($i = 0; $i < self::MAX_ATTEMPTS; $i++) {
            $this->from(route('login'))->post('/login', [
                'email' => $user->email,
                'password' => 'wrongpassword1',
            ])->assertRedirect(route('login'));
        }

        // The web path gets a throttled response (Laravel renders 429 for
        // LoginThrottledException; for a standard form POST it renders the
        // throttling page/redirect rather than the JSON envelope):
        $this->from(route('login'))->post('/login', [
            'email' => $user->email,
            'password' => 'correcthorse1',
        ])->assertStatus(429);
    }
}
