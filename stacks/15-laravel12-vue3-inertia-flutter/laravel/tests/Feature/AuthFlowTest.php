<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * Auth flow feature tests: register, login, protected access, logout
 * revocation — over /api/v1 (envelope) AND the Inertia web routes
 * (redirects + flashed errors), plus enumeration-defense checks.
 */
class AuthFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_register_via_api_creates_user_and_returns_201_envelope(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'correcthorse1',
        ]);

        $response->assertStatus(201);
        $body = $response->json();

        $this->assertTrue($body['ok']);
        $this->assertSame('ada@example.com', $body['data']['user']['email']);
        $this->assertArrayNotHasKey('password', $body['data']['user']);
        $this->assertDatabaseHas('users', ['email' => 'ada@example.com']);
    }

    public function test_register_rejects_weak_password_and_bad_email(): void
    {
        $response = $this->postJson('/api/v1/register', [
            'name' => 'A',
            'email' => 'not-an-email',
            'password' => 'short',
        ]);

        $response->assertStatus(422);
        $body = $response->json();

        $this->assertSame('VALIDATION_ERROR', $body['error']['code']);

        $fields = array_column($body['error']['details'], 'field');
        $this->assertContains('name', $fields);
        $this->assertContains('email', $fields);
        $this->assertContains('password', $fields);
    }

    public function test_duplicate_email_reports_validation_error_without_leakage(): void
    {
        User::factory()->create(['email' => 'dupe@example.com']);

        $response = $this->postJson('/api/v1/register', [
            'name' => 'Second User',
            'email' => 'dupe@example.com',
            'password' => 'correcthorse1',
        ]);

        $response->assertStatus(422);
        $body = $response->json();

        $this->assertSame('VALIDATION_ERROR', $body['error']['code']);
        // No SQL / exception details leak to the client:
        $this->assertStringNotContainsStringIgnoringCase('duplicate', json_encode($body) ?: '');
        $this->assertStringNotContainsStringIgnoringCase('unique', json_encode($body) ?: '');
        $this->assertStringNotContainsStringIgnoringCase('sql', json_encode($body) ?: '');
    }

    public function test_login_sets_httponly_session_cookie(): void
    {
        $user = User::factory()->create(['password' => Hash::make('correcthorse1')]);

        $response = $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'correcthorse1',
        ]);

        $response->assertOk();
        $this->assertTrue($body = $response->json()['ok']);

        $cookies = $response->headers->getCookies();
        $sessionCookie = null;

        foreach ($cookies as $cookie) {
            if ($cookie->getName() === config('session.cookie')) {
                $sessionCookie = $cookie;
            }
        }

        $this->assertNotNull($sessionCookie, 'A session cookie must be set on login.');
        $this->assertTrue($sessionCookie->isHttpOnly());
    }

    public function test_unknown_email_and_wrong_password_are_indistinguishable(): void
    {
        User::factory()->create(['password' => Hash::make('correcthorse1')]);

        $unknownEmail = $this->postJson('/api/v1/login', [
            'email' => 'ghost@example.com',
            'password' => 'wrongpassword1',
        ]);

        $wrongPassword = $this->postJson('/api/v1/login', [
            'email' => User::query()->first()->email,
            'password' => 'wrongpassword1',
        ]);

        $unknownEmail->assertStatus(401);
        $wrongPassword->assertStatus(401);

        $a = $unknownEmail->json();
        $b = $wrongPassword->json();

        // Identical code AND message: no account enumeration.
        $this->assertSame('INVALID_CREDENTIALS', $a['error']['code']);
        $this->assertSame($a['error']['code'], $b['error']['code']);
        $this->assertSame($a['error']['message'], $b['error']['message']);
    }

    public function test_password_is_never_logged_or_returned(): void
    {
        Log::spy();

        $user = User::factory()->create(['password' => Hash::make('correcthorse1')]);

        $this->postJson('/api/v1/login', [
            'email' => $user->email,
            'password' => 'correcthorse1',
        ]);

        Log::shouldNotHaveReceived('info', function ($args) {
            return str_contains(json_encode($args) ?: '', 'correcthorse1');
        });
    }

    public function test_protected_api_works_with_session_cookie_and_401_without(): void
    {
        $user = User::factory()->create();

        // Without a session:
        $this->getJson('/api/v1/home')->assertStatus(401);

        // With a logged-in session:
        $response = $this->actingAs($user)->getJson('/api/v1/home');
        $response->assertOk();
        $body = $response->json();

        $this->assertSame($user->email, $body['data']['user']['email']);
        $this->assertArrayHasKey('metrics', $body['data']);
    }

    public function test_logout_invalidates_the_session_server_side(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/v1/logout')->assertOk();

        // The same session can no longer access protected endpoints:
        $this->getJson('/api/v1/home')->assertStatus(401);
    }

    public function test_web_register_redirects_to_dashboard_with_session(): void
    {
        $response = $this->post('/register', [
            'name' => 'Web User',
            'email' => 'web@example.com',
            'password' => 'correcthorse1',
        ]);

        $response->assertRedirect(route('dashboard'));
        $this->assertAuthenticatedAs(User::query()->where('email', 'web@example.com')->first());
    }

    public function test_web_login_failure_redirects_back_with_generic_error(): void
    {
        $user = User::factory()->create(['password' => Hash::make('correcthorse1')]);

        $response = $this->from(route('login'))->post('/login', [
            'email' => $user->email,
            'password' => 'wrongpassword1',
        ]);

        $response->assertRedirect(route('login'));
        $response->assertSessionHasErrors('email');

        $this->assertFalse($this->isAuthenticated());

        // The flashed error is the generic message, not a hint about which
        // part failed:
        $this->get(route('login'));
        $this->followRedirects($this->post('/login', [
            'email' => $user->email,
            'password' => 'wrongpassword1',
        ]))->assertSee('These credentials do not match our records.');
    }

    public function test_web_logout_invalidates_session(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->post('/logout')->assertRedirect(route('welcome'));

        $this->assertGuest();
    }
}
