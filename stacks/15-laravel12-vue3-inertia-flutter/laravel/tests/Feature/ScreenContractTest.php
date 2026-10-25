<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Screen-level smoke tests for the four Inertia screens: welcome,
 * register/login pages, dashboard, notes screens, workbench — including the
 * auth gate (dashboard redirects guests to login).
 */
class ScreenContractTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The four screens render the Inertia root blade; tests must not
        // depend on a prior `npm run build` (the manifest is a deploy
        // artifact). Vite asset injection is irrelevant to what these tests
        // assert (routes, auth gates, page props envelope).
        $this->withoutVite();
    }

    public function test_welcome_renders_for_guests(): void
    {
        $response = $this->get('/');

        $response->assertOk();
        $content = $response->getContent() ?: '';
        $this->assertStringContainsString('data-page', $content, 'Inertia root must embed the page JSON.');
        $this->assertStringContainsString('Welcome', $content);
    }

    public function test_register_and_login_pages_render_for_guests(): void
    {
        $this->get('/register')->assertOk();
        $this->get('/login')->assertOk();
    }

    public function test_dashboard_requires_authentication(): void
    {
        $this->get('/dashboard')->assertRedirect(route('login'));
    }

    public function test_dashboard_renders_for_authenticated_users(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $content = $response->getContent() ?: '';
        $this->assertStringContainsString($user->email, $content, 'Dashboard shows the authenticated profile.');
    }

    public function test_notes_and_workbench_require_authentication(): void
    {
        $this->get('/notes')->assertRedirect(route('login'));
        $this->get('/notes/create')->assertRedirect(route('login'));
        $this->get('/algorithm')->assertRedirect(route('login'));
    }

    public function test_workbench_renders_catalog_for_authenticated_users(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get('/algorithm');

        $response->assertOk();
        $content = $response->getContent() ?: '';
        $this->assertStringContainsString('Reverse text', $content);
        $this->assertStringContainsString('O(n)', $content);
    }

    public function test_inertia_page_props_envelope_contains_auth_and_flash(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get('/dashboard');
        $content = $response->getContent() ?: '';

        // The Inertia page-prop envelope: auth.user + flash.* are shared on
        // every page (the dual-envelope counterpart of /api/v1's JSON).
        $this->assertMatchesRegularExpression('/"auth"/', $content);
        $this->assertMatchesRegularExpression('/"flash"/', $content);
        $this->assertMatchesRegularExpression('/"user"/', $content);
    }
}
