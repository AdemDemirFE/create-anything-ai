<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\AlgorithmEngine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Algorithm workbench contract tests over /api/v1: fixed catalog, bounded
 * input, measured-vs-theoretical duration separation, no user-code execution.
 */
class AlgorithmApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_catalog_lists_fixed_algorithms(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/api/v1/algorithm');
        $response->assertOk();

        $algorithms = $response->json()['data']['algorithms'];
        $ids = array_column($algorithms, 'id');

        $this->assertSame(['reverse', 'word-count', 'fizzbuzz', 'palindrome'], $ids);

        foreach ($algorithms as $algorithm) {
            $this->assertArrayHasKey('complexity', $algorithm);
            $this->assertArrayHasKey('explanation', $algorithm);
        }
    }

    public function test_run_returns_output_with_measured_duration_and_complexity(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'reverse',
            'input' => 'hello world',
        ]);

        $response->assertOk();
        $body = $response->json()['data'];

        $this->assertSame('dlrow olleh', $body['output']);
        $this->assertIsNumeric($body['execution_ms']);
        $this->assertGreaterThanOrEqual(0.0, (float) $body['execution_ms']);
        $this->assertSame('O(n)', $body['complexity']);
        $this->assertNotSame($body['complexity'], $body['execution_ms'].' ms');
    }

    public function test_oversized_input_is_rejected_not_truncated(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'reverse',
            'input' => str_repeat('a', 10_001),
        ]);

        $response->assertStatus(400);
        $this->assertSame('INPUT_TOO_LARGE', $response->json()['error']['code']);
    }

    /**
     * Review follow-up contract: config('stack.algorithm_max_input') is the
     * DOCUMENTED bound, and the ENGINE must be its single enforcement point.
     * A deployment that tightens ALGORITHM_MAX_INPUT must see the same
     * number in the /api/v1 catalog AND see run() reject input above it.
     */
    public function test_catalog_and_engine_agree_with_configured_bound(): void
    {
        config(['stack.algorithm_max_input' => 250]);

        $user = User::factory()->create();

        $response = $this->actingAs($user)->getJson('/api/v1/algorithm');
        $response->assertOk();
        $this->assertSame(250, $response->json()['data']['maxInputLength']);

        $atBound = $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'reverse',
            'input' => str_repeat('a', 250),
        ]);
        $atBound->assertOk();

        $overBound = $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'reverse',
            'input' => str_repeat('a', 251),
        ]);
        $overBound->assertStatus(400);
        $this->assertSame('INPUT_TOO_LARGE', $overBound->json()['error']['code']);
        $this->assertSame(
            'Input exceeds the maximum of 250 characters.',
            $overBound->json()['error']['message'],
        );
    }

    public function test_engine_clamps_invalid_config_values_tighten_only(): void
    {
        // Loosening attempts and garbage fall back to the default bound.
        config(['stack.algorithm_max_input' => AlgorithmEngine::ABSOLUTE_MAX_INPUT_LENGTH + 1]);
        $this->assertSame(
            AlgorithmEngine::MAX_INPUT_LENGTH,
            app(AlgorithmEngine::class)->maxInputLength(),
        );

        config(['stack.algorithm_max_input' => 0]);
        $this->assertSame(
            AlgorithmEngine::MAX_INPUT_LENGTH,
            app(AlgorithmEngine::class)->maxInputLength(),
        );

        config(['stack.algorithm_max_input' => -5]);
        $this->assertSame(
            AlgorithmEngine::MAX_INPUT_LENGTH,
            app(AlgorithmEngine::class)->maxInputLength(),
        );

        // A legitimate tightening IS honored.
        config(['stack.algorithm_max_input' => 128]);
        $this->assertSame(128, app(AlgorithmEngine::class)->maxInputLength());
    }

    public function test_input_at_the_cap_is_accepted(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'palindrome',
            'input' => str_repeat('a', 10_000),
        ]);

        $response->assertOk();
        $this->assertSame('true', $response->json()['data']['output']);
    }

    public function test_unknown_algorithm_and_invalid_fizzbuzz_input(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'not-in-catalog',
            'input' => 'x',
        ])->assertStatus(400)->assertJsonPath('error.code', 'UNKNOWN_ALGORITHM');

        $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'fizzbuzz',
            'input' => 'nope',
        ])->assertStatus(400)->assertJsonPath('error.code', 'INVALID_INPUT');

        $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'fizzbuzz',
            'input' => '1001',
        ])->assertStatus(400)->assertJsonPath('error.code', 'INVALID_INPUT');
    }

    public function test_engine_source_contains_no_code_execution_primitives(): void
    {
        $source = file_get_contents(app_path('Services/AlgorithmEngine.php')) ?: '';

        foreach (['eval(', 'exec(', 'system(', 'proc_open', 'shell_exec', 'popen', 'assert(', 'create_function'] as $primitive) {
            $this->assertStringNotContainsString($primitive, $source, "Engine must not contain {$primitive}.");
        }
    }

    /** Review follow-up: reverse is code-point safe, not byte-wise strrev. */
    public function test_reverse_is_multibyte_safe(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/algorithm/run', [
            'algorithmId' => 'reverse',
            'input' => 'ünïcødé',
        ]);

        $response->assertOk();
        // strrev would shred these into invalid byte sequences; the code-
        // point reverse must round-trip the characters intact.
        $this->assertSame('édøcïnü', $response->json()['data']['output']);
    }
}
