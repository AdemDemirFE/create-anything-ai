<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Contract tests for the /api/v1 envelope { ok, data, error, requestId } and
 * the X-Request-Id correlation behaviour (docs task: "zarf kontrati",
 * "X-Request-Id validasyonu").
 */
class EnvelopeContractTest extends TestCase
{
    use RefreshDatabase;

    public function test_success_envelope_has_exact_top_level_keys(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertOk();
        $body = $response->json();

        $this->assertSame(['ok', 'data', 'error', 'requestId'], array_keys($body));
        $this->assertTrue($body['ok']);
        $this->assertNull($body['error']);
        $this->assertSame('stack-15', $body['data']['service']);
    }

    public function test_error_envelope_has_stable_code_and_null_data(): void
    {
        $response = $this->postJson('/api/v1/login', [
            'email' => 'not-an-email',
            'password' => 'short',
        ]);

        $response->assertStatus(422);
        $body = $response->json();

        $this->assertFalse($body['ok']);
        $this->assertNull($body['data']);
        $this->assertSame('VALIDATION_ERROR', $body['error']['code']);
        $this->assertIsString($body['error']['message']);
        $this->assertArrayHasKey('details', $body['error']);
        $this->assertNotEmpty($body['error']['details']);

        foreach ($body['error']['details'] as $detail) {
            $this->assertArrayHasKey('field', $detail);
            $this->assertArrayHasKey('code', $detail);
        }
    }

    public function test_request_id_header_and_body_share_the_same_value(): void
    {
        $response = $this->getJson('/api/v1/health');

        $body = $response->json();
        $headerId = $response->headers->get('X-Request-Id');

        $this->assertNotNull($headerId);
        $this->assertSame($headerId, $body['requestId']);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9-]{1,64}$/', $headerId);
    }

    public function test_valid_client_request_id_is_echoed(): void
    {
        foreach (['abc-123', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6-7890', 'r-1'] as $id) {
            $response = $this->getJson('/api/v1/health', ['X-Request-Id' => $id]);

            $this->assertSame($id, $response->headers->get('X-Request-Id'));
            $this->assertSame($id, $response->json()['requestId']);
        }
    }

    public function test_invalid_client_request_id_is_replaced_with_opaque_id(): void
    {
        foreach ([
            'bad id with spaces',
            "injection\nattempt",
            str_repeat('x', 65),
            "id; DROP TABLE users",
            'ünïcödé-id',
        ] as $invalid) {
            $response = $this->getJson('/api/v1/health', ['X-Request-Id' => $invalid]);

            $id = $response->headers->get('X-Request-Id');

            $this->assertNotSame($invalid, $id, "Invalid id must be replaced: {$invalid}");
            $this->assertMatchesRegularExpression('/^[A-Za-z0-9-]{1,64}$/', $id);
            $this->assertSame($id, $response->json()['requestId']);
        }
    }

    public function test_missing_request_id_generates_opaque_id(): void
    {
        $first = $this->getJson('/api/v1/health');
        $second = $this->getJson('/api/v1/health');

        $id1 = $first->headers->get('X-Request-Id');
        $id2 = $second->headers->get('X-Request-Id');

        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', $id1);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', $id2);
        $this->assertNotSame($id1, $id2, 'Each request gets a fresh correlation id.');
    }

    public function test_unauthenticated_protected_api_returns_envelope_401(): void
    {
        $response = $this->getJson('/api/v1/home');

        $response->assertStatus(401);
        $body = $response->json();

        $this->assertFalse($body['ok']);
        $this->assertSame('UNAUTHENTICATED', $body['error']['code']);
    }

    public function test_unknown_route_returns_envelope_404(): void
    {
        $response = $this->getJson('/api/v1/definitely-not-a-route');

        $response->assertStatus(404);
        $this->assertSame('NOT_FOUND', $response->json()['error']['code']);
    }
}
