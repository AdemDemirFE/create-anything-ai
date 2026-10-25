<?php

namespace Tests\Feature\Livewire;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Livewire component tests for the notes list (screen 2b).
 *
 * Uses Livewire::test() to drive the component's PUBLIC ACTIONS directly —
 * the same entry points wire:click uses in the browser — and asserts the
 * server-rendered output + database effects.
 */
class NotesIndexTest extends TestCase
{
    use RefreshDatabase;

    public function test_component_renders_the_users_notes(): void
    {
        $user = User::factory()->hasNotes(2, ['title' => 'Indexed note'])->create();

        $component = Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Index::class);

        $component->assertOk()
            ->assertSee('Indexed note');
        $this->assertSame(2, $component->get('notes')->count());
    }

    public function test_search_action_filters_the_rendered_list(): void
    {
        $user = User::factory()->create();
        $user->notes()->create(['title' => 'Alpha report', 'body' => 'first']);
        $user->notes()->create(['title' => 'Beta memo', 'body' => 'second']);

        $component = Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Index::class);

        // wire:model.live.debounce.300ms="search" ends in set() → filtering.
        $component->set('search', 'alpha')
            ->assertSee('Alpha report')
            ->assertDontSee('Beta memo');
    }

    /**
     * Review follow-up: the user's search term is a LITERAL substring —
     * LIKE wildcards inside it (% _) must be escaped, so "50%" matches
     * "50% off" (one row) instead of every row containing "50<anything>".
     */
    public function test_search_treats_like_wildcards_as_literals(): void
    {
        $user = User::factory()->create();
        $user->notes()->create(['title' => '50% off deal', 'body' => 'no numbers here']);
        $user->notes()->create(['title' => '50 percent alternative', 'body' => 'half price']);

        $component = Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Index::class)
            ->set('search', '50% off');

        $html = $component->assertOk()->html();
        $this->assertStringContainsString('50% off deal', $html);
        $this->assertStringNotContainsString('50 percent alternative', $html);
    }

    public function test_delete_action_removes_only_the_owned_note(): void
    {
        $user = User::factory()->create();
        $note = $user->notes()->create(['title' => 'Doomed note']);

        $component = Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Index::class);

        $component->call('confirmDelete', $note->id);
        $this->assertSame([$note->id], $component->get('pendingDeletes'));

        $component->call('delete', $note->id);

        $this->assertDatabaseMissing('notes', ['id' => $note->id]);
        $component->assertOk();
    }

    public function test_delete_action_ignores_foreign_notes(): void
    {
        $owner = User::factory()->create();
        $foreign = $owner->notes()->create(['title' => 'Not yours']);

        $user = User::factory()->create();

        Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Index::class)
            ->call('confirmDelete', $foreign->id)
            ->call('delete', $foreign->id);

        // Foreign note survives: ownership scope is server-side.
        $this->assertDatabaseHas('notes', ['id' => $foreign->id]);
    }

    public function test_guest_cannot_render_the_component_page(): void
    {
        $this->get(route('notes.index'))->assertRedirect(route('login'));
    }
}
