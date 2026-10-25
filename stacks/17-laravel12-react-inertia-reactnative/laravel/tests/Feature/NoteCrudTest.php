<?php

namespace Tests\Feature;

use App\Models\Note;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Notes CRUD over /api/v1 (envelope) and the Inertia web routes, including
 * the ownership rule (review follow-up): another user's note is NOT_FOUND —
 * identical to a missing id, so note ids cannot be probed for existence
 * (no 403 existence leak) — plus the bounded list contract
 * (default/max limit, page, total, hasMore metadata).
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

    /**
     * Review follow-up (no-enumeration): a FOREIGN note id must be
     * indistinguishable from a MISSING id — 404 NOT_FOUND both ways, for
     * read AND write. The previous 403 FORBIDDEN told a probing client the
     * id exists (but belongs to someone else); the owner-scoped lookup
     * removes that signal entirely.
     */
    public function test_another_users_note_is_not_found_like_a_missing_one(): void
    {
        $owner = User::factory()->create();
        $attacker = User::factory()->create();
        $note = Note::factory()->create(['user_id' => $owner->id]);
        $missingId = Note::query()->max('id') + 999;

        // Foreign id and missing id produce the SAME status AND envelope:
        foreach ([
            "foreign read" => $this->actingAs($attacker)->getJson("/api/v1/notes/{$note->id}"),
            "missing read" => $this->actingAs($attacker)->getJson("/api/v1/notes/{$missingId}"),
        ] as $label => $response) {
            $response->assertStatus(404);
            $body = $response->json();
            $this->assertSame('NOT_FOUND', $body['error']['code'], "{$label} must map to NOT_FOUND.");
        }

        // Writes are equally silent (404, never 403):
        $this->actingAs($attacker)->putJson("/api/v1/notes/{$note->id}", ['title' => 'Hacked'])->assertStatus(404);
        $this->actingAs($attacker)->deleteJson("/api/v1/notes/{$note->id}")->assertStatus(404);

        // The note itself is untouched:
        $this->assertDatabaseHas('notes', ['id' => $note->id, 'title' => $note->title]);
    }

    public function test_web_crud_round_trip(): void
    {
        $user = User::factory()->create();

        $create = $this->actingAs($user)->post('/notes', [
            'title' => 'Web note',
            'body' => 'Created via Inertia form.',
        ]);

        $note = Note::query()->where('title', 'Web note')->firstOrFail();
        $create->assertRedirect(route('notes.show', $note));

        $update = $this->actingAs($user)->put("/notes/{$note->id}", [
            'title' => 'Web note (edited)',
            'body' => 'Updated.',
        ]);
        $update->assertRedirect(route('notes.show', $note));
        $this->assertDatabaseHas('notes', ['id' => $note->id, 'title' => 'Web note (edited)']);

        $this->actingAs($user)->delete("/notes/{$note->id}")
            ->assertRedirect(route('notes.index'));

        $this->assertDatabaseMissing('notes', ['id' => $note->id]);
    }

    /**
     * Review follow-up (bounded list): the API list never returns an
     * unbounded table. Default limit 50, hard max 100 (larger ?limit=
     * clamps), and the envelope carries page/limit/total/hasMore.
     */
    public function test_api_list_is_bounded_with_pagination_metadata(): void
    {
        $user = User::factory()->create();
        Note::factory()->count(7)->create(['user_id' => $user->id]);

        // Default: no query params at all.
        $response = $this->actingAs($user)->getJson('/api/v1/notes');
        $response->assertOk();
        $data = $response->json()['data'];
        $this->assertCount(7, $data['notes']);
        $this->assertSame(1, $data['page']);
        $this->assertSame(50, $data['limit']);
        $this->assertSame(7, $data['total']);
        $this->assertFalse($data['hasMore']);

        // Explicit limit + second page:
        $p1 = $this->actingAs($user)->getJson('/api/v1/notes?limit=3&page=1')->assertOk()->json()['data'];
        $this->assertCount(3, $p1['notes']);
        $this->assertSame(3, $p1['limit']);
        $this->assertSame(7, $p1['total']);
        $this->assertTrue($p1['hasMore']);

        $p2 = $this->actingAs($user)->getJson('/api/v1/notes?limit=3&page=2')->assertOk()->json()['data'];
        $this->assertCount(3, $p2['notes']);
        $this->assertTrue($p2['hasMore']);

        $p3 = $this->actingAs($user)->getJson('/api/v1/notes?limit=3&page=3')->assertOk()->json()['data'];
        $this->assertCount(1, $p3['notes']);
        $this->assertFalse($p3['hasMore']);

        // Pages do not overlap (stable ordering: created_at desc, id desc):
        $ids = array_merge(
            array_column($p1['notes'], 'id'),
            array_column($p2['notes'], 'id'),
            array_column($p3['notes'], 'id'),
        );
        $this->assertCount(7, array_unique($ids));
        $this->assertEqualsCanonicalizing(
            Note::query()->where('user_id', $user->id)->pluck('id')->all(),
            $ids,
        );
    }

    public function test_api_list_clamps_limit_above_max_and_rejects_garbage(): void
    {
        $user = User::factory()->create();
        Note::factory()->count(3)->create(['user_id' => $user->id]);

        // Above the hard max (100): clamps, never an error, never unbounded.
        $clamped = $this->actingAs($user)->getJson('/api/v1/notes?limit=100000')->assertOk()->json()['data'];
        $this->assertSame(100, $clamped['limit']);
        $this->assertCount(3, $clamped['notes']);

        // Zero / negative / non-numeric fall back to the default (50):
        foreach (['0', '-5', 'abc'] as $bad) {
            $data = $this->actingAs($user)->getJson("/api/v1/notes?limit={$bad}")->assertOk()->json()['data'];
            $this->assertSame(50, $data['limit'], "limit={$bad} must fall back to the default.");
        }

        // page=0 / negative clamp to 1:
        foreach (['0', '-3'] as $bad) {
            $data = $this->actingAs($user)->getJson("/api/v1/notes?page={$bad}")->assertOk()->json()['data'];
            $this->assertSame(1, $data['page'], "page={$bad} must clamp to 1.");
        }
    }

    public function test_web_notes_index_is_also_bounded(): void
    {
        $user = User::factory()->create();
        Note::factory()->count(4)->create(['user_id' => $user->id]);

        $response = $this->actingAs($user)->get('/notes?limit=2&page=1');
        $response->assertOk();

        $content = $response->getContent() ?: '';
        // The Inertia page receives the bounded prop set (page/limit):
        $this->assertStringContainsString('"page":1', $content);
        $this->assertStringContainsString('"limit":2', $content);
    }

    public function test_web_notes_index_shows_only_own_notes(): void
    {
        $user = User::factory()->create();
        Note::factory()->create(['user_id' => $user->id, 'title' => 'Mine']);
        Note::factory()->create(['title' => 'Theirs']);

        $response = $this->actingAs($user)->get('/notes');

        $response->assertOk();
        // Inertia pages render the page component; the raw HTML contains the
        // JSON-encoded page props in the data-page attribute:
        $content = $response->getContent() ?: '';
        $this->assertStringContainsString('Mine', $content);
        $this->assertStringNotContainsString('Theirs', $content);
    }
}
