<?php

namespace Tests\Feature\Livewire;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Livewire component tests for the algorithm workbench (screen 4b).
 * Fixed catalog, bounded input, measured-vs-static complexity separation.
 */
class WorkbenchTest extends TestCase
{
    use RefreshDatabase;

    public function test_run_action_renders_output_with_measured_and_static_timing(): void
    {
        $user = User::factory()->create();

        $component = Livewire::actingAs($user)
            ->test(\App\Livewire\Workbench::class)
            ->set('input', 'hello world')
            ->call('run')
            ->assertHasNoErrors();

        $result = $component->get('result');
        $this->assertSame('dlrow olleh', $result['output']);
        $this->assertIsFloat($result['execution_ms']);
        $this->assertSame('O(n)', $result['complexity']);
        $this->assertNotSame('O(n)', $result['execution_ms']); // measured ≠ static
    }

    public function test_unknown_algorithm_surfaces_a_field_error(): void
    {
        $user = User::factory()->create();

        Livewire::actingAs($user)
            ->test(\App\Livewire\Workbench::class)
            ->set('algorithmId', 'nope-nope')
            ->set('input', 'x')
            ->call('run')
            ->assertHasErrors(['algorithmId']);
    }

    public function test_oversized_input_is_rejected_not_truncated(): void
    {
        $user = User::factory()->create();

        Livewire::actingAs($user)
            ->test(\App\Livewire\Workbench::class)
            ->set('input', str_repeat('y', 10_001))
            ->call('run')
            ->assertHasErrors(['input']);

        $this->assertNull(Livewire::actingAs($user)
            ->test(\App\Livewire\Workbench::class)
            ->get('result'));
    }

    public function test_component_page_renders_the_fixed_catalog(): void
    {
        $user = User::factory()->create();

        Livewire::actingAs($user)
            ->test(\App\Livewire\Workbench::class)
            ->assertOk()
            ->assertSee('Reverse text')
            ->assertSee('Palindrome check');
    }
}
