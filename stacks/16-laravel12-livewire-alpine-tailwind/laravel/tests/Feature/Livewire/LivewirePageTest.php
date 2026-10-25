<?php

namespace Tests\Feature\Livewire;

use App\Models\Note;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Full-page Livewire screens over the HTTP layer: route → component mount →
 * rendered HTML carries the wire:snapshot payload (the marker that the page
 * was served by a Livewire full-page component, not a plain Blade view).
 */
class LivewirePageTest extends TestCase
{
    use RefreshDatabase;

    public function test_notes_index_page_mounts_as_livewire(): void
    {
        $user = User::factory()->hasNotes(1, ['title' => 'Snapshot note'])->create();

        $this->actingAs($user)
            ->get(route('notes.index'))
            ->assertOk()
            ->assertSee('wire:snapshot', false)
            ->assertSee('Snapshot note');
    }

    public function test_note_show_page_rejects_foreign_notes_with_404(): void
    {
        $owner = User::factory()->create();
        $foreign = $owner->notes()->create(['title' => 'Secret']);

        $user = User::factory()->create();

        $this->actingAs($user)
            ->get(route('notes.show', $foreign))
            ->assertNotFound();

        $this->actingAs($owner)
            ->get(route('notes.show', $foreign))
            ->assertOk()
            ->assertSee('Secret');
    }

    public function test_workbench_page_mounts_as_livewire(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->get(route('algorithm.index'))
            ->assertOk()
            ->assertSee('wire:snapshot', false);
    }
}
