<?php

namespace Tests\Feature;

use App\Models\Note;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Notes CRUD over /api/v1 (envelope) — the JSON mirror of the Livewire note
 * surface — including the ownership rule: another user's note is FORBIDDEN,
 * never leaking existence differences beyond 403. The BROWSER-side CRUD
 * interactions are covered by the Livewire component tests (tests/Feature/
 * Livewire); this suite pins the /api/v1 contract.
 */
class NoteCrudTest extends TestCase
{
    use RefreshDatabase;

    public function test_create_note_via_api_returns_201_envelope(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/notes', [
            'title' => 'First note',
            'body' => 'Hello from the API.',
        ]);

        $response->assertStatus(201);
        $body = $response->json();

        $this->assertTrue($body['ok']);
        $this->assertSame('First note', $body['data']['note']['title']);
        $this->assertDatabaseHas('notes', ['user_id' => $user->id, 'title' => 'First note']);
    }

    public function test_create_note_validates_bounded_input(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/v1/notes', [
            'title' => str_repeat('x', 121),
            'body' => str_repeat('y', 5001),
        ]);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_ERROR', $response->json()['error']['code']);

        $fields = array_column($response->json()['error']['details'], 'field');
        $this->assertContains('title', $fields);
        $this->assertContains('body', $fields);
    }

    public function test_list_returns_only_the_users_notes(): void
    {
        $user = User::factory()->create();
        $stranger = User::factory()->create();

        Note::factory()->count(3)->create(['user_id' => $user->id]);
        Note::factory()->count(2)->create(['user_id' => $stranger->id]);

        $response = $this->actingAs($user)->getJson('/api/v1/notes');
        $response->assertOk();

        $notes = $response->json()['data']['notes'];
        $this->assertCount(3, $notes);
    }

    public function test_show_update_and_delete_own_note(): void
    {
        $user = User::factory()->create();
        $note = Note::factory()->create(['user_id' => $user->id, 'title' => 'Original']);

        $this->actingAs($user)->getJson("/api/v1/notes/{$note->id}")
            ->assertOk()
            ->assertJsonPath('data.note.title', 'Original');

        $this->actingAs($user)->putJson("/api/v1/notes/{$note->id}", [
            'title' => 'Updated',
            'body' => 'New body.',
        ])->assertOk()->assertJsonPath('data.note.title', 'Updated');

        $this->actingAs($user)->deleteJson("/api/v1/notes/{$note->id}")
            ->assertOk()
            ->assertJsonPath('data.deleted', true);

        $this->assertDatabaseMissing('notes', ['id' => $note->id]);
    }

    public function test_another_users_note_is_forbidden_and_never_returned(): void
    {
        $owner = User::factory()->create();
        $attacker = User::factory()->create();
        $note = Note::factory()->create(['user_id' => $owner->id]);

        $this->actingAs($attacker)->getJson("/api/v1/notes/{$note->id}")->assertStatus(403);
        $this->actingAs($attacker)->putJson("/api/v1/notes/{$note->id}", ['title' => 'Hacked'])->assertStatus(403);
        $this->actingAs($attacker)->deleteJson("/api/v1/notes/{$note->id}")->assertStatus(403);

        $this->assertDatabaseHas('notes', ['id' => $note->id, 'title' => $note->title]);
    }

    public function test_unauthenticated_note_reads_are_401_envelope(): void
    {
        $owner = User::factory()->create();
        $note = Note::factory()->create(['user_id' => $owner->id]);

        $this->getJson('/api/v1/notes')->assertStatus(401);
        $this->getJson("/api/v1/notes/{$note->id}")->assertStatus(401);
        $this->postJson('/api/v1/notes', ['title' => 'x'])->assertStatus(401);
    }
}
