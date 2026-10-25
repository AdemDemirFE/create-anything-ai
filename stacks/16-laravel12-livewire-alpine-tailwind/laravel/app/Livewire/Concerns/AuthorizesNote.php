<?php

namespace App\Livewire\Concerns;

use App\Models\Note;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * Shared ownership-safe note lookup for the Livewire note components.
 *
 * Route-model binding would 404 on foreign ids; inside Livewire actions the
 * id arrives from the client, so every lookup re-scopes to the authenticated
 * user's notes. A foreign or missing id yields null (never an authorization
 * or existence leak — the UI simply does not act on it).
 */
trait AuthorizesNote
{
    protected function findOwnedNote(int $noteId): ?Note
    {
        /** @var Note|null $note */
        $note = auth()->user()->notes()->whereKey($noteId)->first();

        return $note;
    }

    protected function findOwnedNoteOrFail(int $noteId): Note
    {
        $note = $this->findOwnedNote($noteId);

        if ($note === null) {
            throw (new ModelNotFoundException)->setModel(Note::class, [$noteId]);
        }

        return $note;
    }
}
