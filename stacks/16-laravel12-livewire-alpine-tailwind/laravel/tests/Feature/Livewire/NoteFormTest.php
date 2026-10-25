<?php

namespace Tests\Feature\Livewire;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Livewire component tests for the note form (screen 4a, create + edit).
 * Drives the save()/cancel() actions that wire:submit/wire:click invoke.
 */
class NoteFormTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_mode_persists_a_note_via_the_save_action(): void
    {
        $user = User::factory()->create();

        Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Form::class)
            ->set('title', 'Fresh note')
            ->set('body', 'Created through a Livewire action.')
            ->call('save')
            ->assertHasNoErrors();

        $this->assertDatabaseHas('notes', [
            'user_id' => $user->id,
            'title' => 'Fresh note',
            'body' => 'Created through a Livewire action.',
        ]);
    }

    public function test_validation_rejects_oversized_or_missing_fields(): void
    {
        $user = User::factory()->create();

        Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Form::class)
            ->set('title', '')
            ->set('body', str_repeat('x', 5001))
            ->call('save')
            ->assertHasErrors(['title' => 'required'])
            ->assertHasErrors(['body' => 'max']);

        $this->assertDatabaseCount('notes', 0);
    }

    public function test_edit_mode_loads_and_updates_the_owned_note(): void
    {
        $user = User::factory()->create();
        $note = $user->notes()->create(['title' => 'Old title', 'body' => 'Old body']);

        Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Form::class, ['note' => $note])
            ->assertSet('title', 'Old title')
            ->set('title', 'New title')
            ->call('save')
            ->assertHasNoErrors();

        $this->assertDatabaseHas('notes', ['id' => $note->id, 'title' => 'New title']);
    }

    public function test_locked_note_id_cannot_be_forged_to_edit_a_foreign_note(): void
    {
        $owner = User::factory()->create();
        $foreign = $owner->notes()->create(['title' => 'Not yours']);

        $user = User::factory()->create();

        // noteId is #[Locked]: a client-sent update hijack is rejected by
        // Livewire itself with CannotUpdateLockedPropertyException.
        $this->expectException(\Livewire\Features\SupportLockedProperties\CannotUpdateLockedPropertyException::class);

        Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Form::class)
            ->set('noteId', $foreign->id);
    }

    public function test_forced_foreign_note_id_still_re_scopes_to_the_owner(): void
    {
        $owner = User::factory()->create();
        $foreign = $owner->notes()->create(['title' => 'Not yours']);

        $user = User::factory()->create();

        // Defense in depth: even a property forced past Livewire (as a
        // hand-crafted request could try) re-scopes through findOwnedNote,
        // so the foreign note is never touched.
        Livewire::actingAs($user)
            ->test(\App\Livewire\Notes\Form::class)
            ->tap(function ($component) use ($foreign): void {
                $component->noteId = $foreign->id; // force-past-Livewire attempt
            })
            ->set('title', 'Hijacked')
            ->call('save');

        $this->assertDatabaseHas('notes', ['id' => $foreign->id, 'title' => 'Not yours']);
    }
}
